const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const http = require('node:http')
const { once } = require('node:events')
const crypto = require('node:crypto')
const { fixture } = require('./fixtures/device-integration')
const { createTestLocationStore, COLLECTION, PATH, TTL_MS } = require('../server/mini-device-cloudrun/test-location-store')
const { createTestIngressRuntime, createTestIngressServer } = require('../server/mini-device-cloudrun/test-location-ingress')
const { createTestTcpRelay, validate } = require('../server/mini-device-cloudrun/test-location-tcp-relay')
const { createForwarder } = require('../server/mini-device-cloudrun/location-tcp-relay')
const { createRuntime } = require('../server/mini-device-cloudrun/runtime')
const { createServer } = require('../server/mini-device-cloudrun/server')
const { signHeaders, verify, credentials } = require('../server/mini-device-cloudrun/location-ingest-auth')
const { createDeviceSetup } = require('../miniprogram/services/device/setup')
const { projectTestLocation } = require('../miniprogram/services/device/test-location-view')
async function prepared() {
  const f = await fixture()
  Object.assign(f.config, { testLocationEnabled: true, testLocationTests: JSON.stringify([f.scope]), testLocationReaders: JSON.stringify([f.user.openid]), testLocationExpiresAt: new Date(f.now() + 60000).toISOString() })
  f.store = createTestLocationStore({ repo: f.repo, config: f.config, authorize: f.service.authorize, now: f.now })
  f.actor = { deviceIds: new Set([f.scope.deviceId]) }
  f.report = (extra = {}) => ({ version: 1, purpose: 'engineer-location-test', eventId: crypto.randomUUID(), deviceId: f.scope.deviceId, bindingVersion: 1, observedAt: f.now(), status: 'received', longitude: 121.4567, latitude: 31.23456, coordinateSystem: 'UNKNOWN', ...extra })
  return f
}
test('测试坐标不受 A/B 限制，未知坐标系和缺采集时间仅用于收包诊断，不写正式定位', async () => {
  const f = await prepared()
  for (const longitude of [121.4567, 110.9876, 108.1234]) {
    f.advance(1); await f.store.ingest(f.report({ longitude }), f.actor)
    const data = await f.store.snapshot(f.user, f.scope)
    assert.equal(data.point.longitude, longitude); assert.equal(data.measuredAt, null); assert.equal(data.diagnosticOnly, true)
    assert.equal(projectTestLocation(data, f.scope, f.now(), f.now()).hasPoint, true)
  }
  assert.equal((await f.repo.list(COLLECTION, {})).length, 1)
  assert.equal(await f.repo.get('mini_current_locations', f.scope.deviceId), null)
})
test('测试入口默认关闭，必须明确设备/查看者/截止时间；无签名不开放', async () => {
  const f = await prepared(), disabled = createTestLocationStore({ repo: f.repo, config: {}, now: f.now })
  await assert.rejects(disabled.ingest(f.report(), f.actor), { code: 'PROVIDER_NOT_CONFIGURED' })
  for (const patch of [{ testLocationTests: '[]' }, { testLocationReaders: '[]' }, { testLocationExpiresAt: '' }, { testLocationTests: '{bad' }]) {
    assert.throws(() => createTestLocationStore({ repo: f.repo, config: { ...f.config, ...patch } }), { code: 'CONFIG_REQUIRED' })
  }
  assert.throws(() => createTestIngressRuntime(f.config, { repo: f.repo }), { code: 'AUTH_NOT_CONFIGURED' })
  f.advance(60001); await assert.rejects(f.store.snapshot(f.user, f.scope), { code: 'PROVIDER_NOT_CONFIGURED' })
})
test('非法坐标/时间/额外字段/凭证范围拒绝，不再检查预设点', async () => {
  const f = await prepared()
  for (const patch of [{ longitude: 181 }, { latitude: -91 }, { longitude: NaN }, { latitude: '30' }, { longitude: 0, latitude: 0 }, { measuredAt: f.now() }, { observedAt: f.now() + 2000 }, { observedAt: f.now() - TTL_MS }, { coordinateSystem: 'BD09' }, { purpose: 'synthetic' }, { status: 'offline' }]) {
    await assert.rejects(f.store.ingest(f.report(patch), f.actor), { code: 'INVALID_LOCATION' })
  }
  await assert.rejects(f.store.ingest(f.report(), { deviceIds: new Set(['other']) }), { code: 'FORBIDDEN' })
  await assert.rejects(f.store.ingest(f.report({ deviceId: 'other' }), f.actor), { code: 'FORBIDDEN' })
  await assert.rejects(f.store.ingest(f.report({ bindingVersion: 2 }), f.actor), { code: 'BINDING_CHANGED' })
  assert.equal((await f.repo.list(COLLECTION, {})).length, 0)
})
test('收包去重/乱序不续命，离线和过期清点，恢复只接受更新报文', async () => {
  const f = await prepared(), first = f.report()
  await f.store.ingest(first, f.actor)
  f.advance(10)
  assert.equal((await f.store.ingest(first, f.actor)).duplicate, true)
  await assert.rejects(f.store.ingest({ ...first, longitude: 100 }, f.actor), { code: 'REQUEST_CONFLICT' })
  assert.equal((await f.store.ingest(f.report({ observedAt: first.observedAt - 1 }), f.actor)).ignored, true)
  await f.store.ingest(f.report({ status: 'offline', longitude: null, latitude: null }), f.actor)
  assert.equal((await f.store.snapshot(f.user, f.scope)).point, null)
  f.advance(1); await f.store.ingest(f.report(), f.actor); f.advance(TTL_MS)
  assert.equal((await f.store.snapshot(f.user, f.scope)).status, 'stale')
  assert.equal((await f.repo.get(COLLECTION, f.scope.deviceId)).point, null)
})
test('仅指定查看者且绑定/定位权限/同意均有效才返回；撤权在事务内重验', async () => {
  const f = await prepared(); await f.store.ingest(f.report(), f.actor)
  await assert.rejects(f.store.snapshot({ ...f.user, openid: 'outsider' }, f.scope), { code: 'FORBIDDEN' })
  await assert.rejects(f.store.snapshot(f.user, { ...f.scope, childId: 'other' }), { code: 'BINDING_CHANGED' })
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, permissions: { viewDevice: true, locateDevice: false } })
  await assert.rejects(f.store.snapshot(f.user, f.scope), { code: 'FORBIDDEN' })
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, consentActive: false })
  await assert.rejects(f.store.snapshot(f.user, f.scope), e => ['CONSENT_REQUIRED', 'FORBIDDEN'].includes(e.code))
  await f.repo.put('mini_memberships', 'member-a', f.member)
  let release, entered
  const gate = new Promise(resolve => { entered = resolve })
  const holding = f.repo.transaction(async tx => { entered(); await new Promise(resolve => { release = resolve }); await tx.put('mini_memberships', 'member-a', { ...f.member, active: false }) })
  await gate
  const pending = f.store.snapshot(f.user, f.scope); release(); await holding
  await assert.rejects(pending, { code: 'FORBIDDEN' })
})
test('测试关闭/解绑/窗口截止清理当前坐标；等待数据库锁时到期不能迟到写入', async () => {
  const f = await prepared(); await f.store.ingest(f.report(), f.actor)
  await f.repo.put('mini_bindings', f.scope.deviceId, { ...f.binding, bindingVersion: 2 })
  await f.store.sweep(); assert.equal((await f.repo.get(COLLECTION, f.scope.deviceId)).point, null)
  await f.repo.put('mini_bindings', f.scope.deviceId, f.binding)
  let release
  const holding = f.repo.transaction(() => new Promise(resolve => { release = resolve }))
  await new Promise(resolve => setImmediate(resolve))
  const write = f.store.ingest(f.report(), f.actor); f.advance(TTL_MS); release(); await holding
  await assert.rejects(write, { code: 'INVALID_LOCATION' })
})
test('定位签名绑定接口路径，不能混用正式接口和测试接口', () => {
  const secret = crypto.randomBytes(32).toString('base64url'), now = Date.now(), bytes = Buffer.from('{}')
  const keys = credentials(JSON.stringify([{ keyId: 'test-relay', secret, deviceIds: ['test-device'] }]))
  const headers = signHeaders('test-relay', secret, bytes, now, PATH)
  assert.equal(verify(headers, bytes, keys, now, PATH).deviceIds.has('test-device'), true)
  assert.throws(() => verify(headers, bytes, keys, now), { code: 'AUTH_REQUIRED' })
})
function relayConfig(extra = {}) { return { host: '127.0.0.1', port: 0, expiresAt: Date.now() + 60000, devices: [{ deviceId: 'test-device', bindingVersion: 1, registrationField: 'imei', registrationValue: 'TEST-IMEI', coordinateSystem: 'UNKNOWN' }], ...extra } }
async function waitUntil(fn) {
  const end = Date.now() + 4000
  while (!fn()) { if (Date.now() > end) throw Error('等待测试事件超时'); await new Promise(resolve => setTimeout(resolve, 10)) }
}
test('本机真实 TCP 分包/粘包 → 签名 HTTP 接收 → 存储 → 私有业务接口 → 小程序读取与投影', async t => {
  const f = await prepared(), secret = crypto.randomBytes(32).toString('base64url'), logs = []
  Object.assign(f.config, { testLocationExpiresAt: new Date(Date.now() + 60000).toISOString(), testLocationRelayKeys: JSON.stringify([{ keyId: 'test-relay', secret, deviceIds: [f.scope.deviceId] }]), gatewayOnlyConfirmed: true, cloudrunEnv: 'test-env' })
  f.repo.health = async () => true
  const ingressRuntime = createTestIngressRuntime(f.config, { repo: f.repo })
  const ingress = createTestIngressServer({ config: f.config, runtime: ingressRuntime, log: x => logs.push(x) })
  await new Promise(resolve => ingress.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => ingress.close(resolve)))
  const base = 'http://127.0.0.1:' + ingress.address().port
  const config = relayConfig({ ingressUrl: base + PATH, keyId: 'test-relay', secret })
  const relay = createTestTcpRelay({ config, log: x => logs.push(x) }), address = await relay.start(); t.after(() => relay.stop())
  const socket = net.connect(address.port, '127.0.0.1'); socket.on('error', () => {}); t.after(() => socket.destroy()); await once(socket, 'connect')
  socket.write('{"imei":"TEST-'); socket.write('IMEI","csq":20}121.4567_31.23456110.'); socket.write('9876_29.87654')
  await waitUntil(() => logs.filter(x => x.code === 'TEST_RECEIPT_ACCEPTED').length === 2)
  const business = createServer({ config: f.config, runtime: createRuntime(f.config, { repo: f.repo }) })
  await new Promise(resolve => business.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => business.close(resolve)))
  const gateway = 'http://127.0.0.1:' + business.address().port + '/api/gateway'
  const wxApi = { cloud: { init() {}, async callContainer(request) {
    // Simulates platform headers ONLY on disposable loopback servers; never used against cloud.
    const response = await fetch(gateway, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wx-source': 'test', 'x-wx-env': 'test-env', 'x-wx-appid': f.config.appid, 'x-wx-openid': f.user.openid }, body: JSON.stringify(request.data) })
    return { statusCode: response.status, data: await response.json() }
  } } }
  const setup = createDeviceSetup({ config: { appId: f.config.appid, transport: 'cloudrun', requestTimeoutMs: 3000, cloudrun: { enabled: true, envId: 'test-env', serviceName: 'test-business', path: '/api/gateway' } }, wxApi, store: { getEpoch: () => 1, getSession: () => ({ privacyAccepted: true }) } })
  const data = await setup.testLocationSnapshot(f.scope)
  assert.equal(projectTestLocation(data, f.scope, Date.now(), Date.now()).longitude, '110.987600')
  assert.equal(data.measuredAt, null); assert.equal(data.coordinateSystem, 'UNKNOWN')
  assert.equal((await fetch(base + '/api/location/report', { method: 'POST' })).status, 404)
  assert.equal((await fetch(base + '/api/gateway', { method: 'POST' })).status, 404)
  assert.equal((await fetch(base + PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
  assert.equal((await fetch(gateway.replace('/api/gateway', PATH), { method: 'POST' })).status, 404)
  assert.equal(JSON.stringify(logs).includes('121.4567'), false); assert.equal(JSON.stringify(logs).includes('TEST-IMEI'), false)
  socket.destroy(); await waitUntil(() => logs.filter(x => x.code === 'TEST_RECEIPT_ACCEPTED').length === 3)
  assert.equal((await setup.testLocationSnapshot(f.scope)).point, null)
  assert.equal(await f.repo.get('mini_current_locations', f.scope.deviceId), null)
})
test('公网明文/无限期/未知注册拒绝，不要求固件增加 AUTH 或发送 A/B', async t => {
  for (const patch of [{ host: '0.0.0.0' }, { expiresAt: NaN }, { expiresAt: Date.now() + 86400001 }]) assert.throws(() => validate(relayConfig(patch), Date.now), { code: 'CONFIG_REQUIRED' })
  const reports = [], relay = createTestTcpRelay({ config: relayConfig(), forward: async x => { reports.push(x); return { accepted: true } } })
  const address = await relay.start(); t.after(() => relay.stop())
  for (const raw of ['121.4567_31.23456', '{"imei":"UNKNOWN"}121.4567_31.23456']) {
    const socket = net.connect(address.port, '127.0.0.1'); socket.on('error', () => {}); await once(socket, 'connect')
    socket.write(raw); await once(socket, 'close')
  }
  assert.equal(reports.length, 0)
})
test('转发响应持续滴流也有总超时，不会永久占住队列', async t => {
  const server = http.createServer((req, res) => {
    req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.write('{')
    const timer = setInterval(() => res.write(' '), 100)
    res.on('close', () => clearInterval(timer))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const forward = createForwarder({ ingressUrl: 'http://127.0.0.1:' + server.address().port + PATH, keyId: 'test-relay', secret: crypto.randomBytes(32).toString('base64url') }, PATH)
  const start = Date.now()
  await assert.rejects(forward({ test: true }), { code: 'INGRESS_UNAVAILABLE' })
  assert(Date.now() - start < 10000)
})
test('注册号数字兼容、会话替换、队列限流和测试窗口到期，不打印定位原报文', async t => {
  let now = Date.now(), release
  const reports = [], logs = []
  const cfg = relayConfig({ devices: [{ deviceId: 'test-device', bindingVersion: 1, registrationField: 'imei', registrationValue: '123456789012345', coordinateSystem: 'UNKNOWN' }], expiresAt: now + 10000 })
  const relay = createTestTcpRelay({ config: cfg, now: () => now, log: row => logs.push(row), forward: report => { reports.push(report); return new Promise(resolve => { release = () => resolve({ accepted: true }) }) } })
  const addr = await relay.start()
  t.after(async () => { now += 20000; if (release) release(); await relay.stop() })
  const a = net.connect(addr.port, '127.0.0.1'); a.on('error', () => {}); await once(a, 'connect')
  a.write('{"imei":123456789012345}121.4567_31.23456')
  await waitUntil(() => reports.length === 1)
  const replaced = once(a, 'close')
  const b = net.connect(addr.port, '127.0.0.1'); b.on('error', () => {}); await once(b, 'connect')
  b.write('{"imei":"123456789012345"}'); await replaced
  const closed = once(b, 'close')
  b.write('111.4567_28.23456'.repeat(10)); await closed
  assert(logs.some(row => row.code === 'QUEUE_LIMIT')); assert.equal(reports.length, 1)
  now += 20000; release(); await relay.stop()
  assert.equal(reports.length, 1); assert.equal(JSON.stringify(logs).includes('123456789012345'), false)
})
test('前端：跨绑定、非法坐标、冒充采集时间拒绝，扣除请求耗时并按期清点', async () => {
  const f = await prepared(); await f.store.ingest(f.report(), f.actor)
  const data = await f.store.snapshot(f.user, f.scope)
  assert.equal(projectTestLocation(data, f.scope, 10, 1010).remainingMs, TTL_MS - 1000)
  assert.equal(projectTestLocation(data, f.scope, 10, 10 + TTL_MS).hasPoint, false)
  for (const patch of [{ bindingVersion: 9 }, { measuredAt: f.now() }, { point: { longitude: 200, latitude: 30 } }, { expiresAt: data.receivedAt + 60000 }]) assert.throws(() => projectTestLocation({ ...data, ...patch }, f.scope, 1, 1), { code: 'INVALID_RESPONSE' })
})
test('测试页：不自动读取；失败/离页/登录改变清点，迟到请求不恢复坐标', async () => {
  const api = require('../miniprogram/services/api'), store = require('../miniprogram/services/store')
  const saved = { Page: global.Page, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, session: store.getSession, epoch: store.getEpoch, bindings: api.getCloudBindings, coordinates: api.getCloudTestCoordinates }
  const f = await prepared(); await f.store.ingest(f.report(), f.actor); const data = await f.store.snapshot(f.user, f.scope)
  const timers = new Map(); let definition, seq = 0, epoch = 1, calls = 0
  global.Page = value => { definition = value }
  global.setTimeout = (fn, delay) => { const key = ++seq; timers.set(key, { fn, delay }); return key }; global.clearTimeout = key => timers.delete(key)
  store.getSession = () => ({ privacyAccepted: true }); store.getEpoch = () => epoch
  api.getCloudBindings = async () => [{ ...f.scope, deviceName: '测试设备', permissions: { locateDevice: true } }]
  api.getCloudTestCoordinates = async () => { calls++; return data }
  try {
    delete require.cache[require.resolve('../miniprogram/pages/my/hardware-location-test')]; require('../miniprogram/pages/my/hardware-location-test')
    const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data, p) } }
    page.onLoad(); page.onShow(); assert.equal(calls, 0)
    await page.load(); await page.start(); assert.equal(page.data.view.hasPoint, true)
    epoch++; timers.get(page.expiryTimer).fn(); assert.equal(page.data.view.hasPoint, false)
    let finish; api.getCloudTestCoordinates = () => new Promise(resolve => { finish = resolve })
    const pending = page.start(); page.onHide(); finish(data); await pending
    assert.equal(page.data.view.hasPoint, false); assert.equal(page.data.devices.length, 0); assert.equal(timers.size, 0)
    page.onShow(); await page.load(); api.getCloudTestCoordinates = async () => { throw { code: 'FORBIDDEN' } }; await page.start()
    assert.match(page.data.error, /授权/); assert.equal(page.data.watching, false); assert.equal(page.data.view.hasPoint, false)
    page.onUnload()
  } finally { global.Page = saved.Page; global.setTimeout = saved.setTimeout; global.clearTimeout = saved.clearTimeout; store.getSession = saved.session; store.getEpoch = saved.epoch; api.getCloudBindings = saved.bindings; api.getCloudTestCoordinates = saved.coordinates }
})
