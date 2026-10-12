const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { fixture } = require('./fixtures/device-integration')
const { credentials, signHeaders, verify, PATH } = require('../server/mini-device-cloudrun/location-ingest-auth')
const { createLocationStore, createLocationProvider } = require('../server/mini-device-cloudrun/location-store')
const { createIngressRuntime, createIngressServer } = require('../server/mini-device-cloudrun/location-ingress')
const { createRuntime } = require('../server/mini-device-cloudrun/runtime')
const { createServer } = require('../server/mini-device-cloudrun/server')
const { createTcpRelay, validateConfig, createForwarder } = require('../server/mini-device-cloudrun/location-tcp-relay')
const { createDeviceClient } = require('../miniprogram/services/device/client')
const secret = 'synthetic-relay-credential-'.padEnd(48, 'x')
const token = 'synthetic-device-credential-'.padEnd(48, 'y')
const appid = 'wxc5abf3407ed4ef30'
const actor = { keyId: 'relay-test', deviceIds: new Set(['test-device']) }
const tick = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(fn) { for (let i = 0; i < 150; i++) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)) } throw Error('本机测试等待超时') }
async function locationFixture(realClock = false) {
  const f = await fixture(), now = realClock ? Date.now : f.now
  const config = { ...f.config, locationProvider: 'push', storageDriver: 'mysql', serviceRole: 'business', cloudrunEnv: 'test-env', gatewayOnlyConfirmed: true,
    locationRelayKeys: JSON.stringify([{ keyId: actor.keyId, secret, deviceIds: [...actor.deviceIds] }]) }
  const repo = { ...f.repo, health: async () => true, close: async () => {} }
  const store = createLocationStore({ repo, config, now })
  const runtime = createRuntime(config, { repo, now })
  let seq = 0
  const report = extra => ({ version: 1, eventId: 'test-event-' + ++seq, deviceId: f.scope.deviceId, bindingVersion: 1, observedAt: now(), measuredAt: now(), status: 'valid', coordinateSystem: 'WGS84', longitude: 120.0001, latitude: 30.0001, accuracyM: 12, battery: 73, ...extra })
  const call = (action, payload = {}) => runtime.dispatch(action, { scope: f.scope, ...payload }, { ...f.user, source: 'wx-cloudrun-gateway' })
  return { ...f, now, repo, config, store, runtime, report, call }
}
test('定位转发鉴权：签名绑定路径/时间/原始字节，缺凭证、篡改、过期和设备白名单拒绝', async () => {
  const f = await locationFixture(), bytes = Buffer.from(JSON.stringify(f.report())), keys = credentials(f.config.locationRelayKeys)
  const h = signHeaders(actor.keyId, secret, bytes, f.now())
  assert.equal(verify(h, bytes, keys, f.now()).keyId, actor.keyId)
  for (const [headers, body, time] of [[{}, bytes, f.now()], [h, Buffer.from('{}'), f.now()], [h, bytes, f.now() + 61000], [{ ...h, 'x-location-signature': [h['x-location-signature']] }, bytes, f.now()]]) assert.throws(() => verify(headers, body, keys, time), { code: 'AUTH_REQUIRED' })
  assert.throws(() => verify(h, bytes, new Map(), f.now()), { code: 'AUTH_NOT_CONFIGURED' })
  await assert.rejects(f.store.ingest(f.report(), { ...actor, deviceIds: new Set(['other']) }), { code: 'FORBIDDEN' })
})
test('定位接收：不导入演示关系，伪造家庭/绑定版本和未知坐标系不能写入', async () => {
  const f = await locationFixture()
  for (const patch of [{ familyId: 'forged' }, { bindingVersion: 9 }, { coordinateSystem: 'UNKNOWN' }, { longitude: '120.0001' }, { measuredAt: f.now() + 6000 }, { longitude: 0, latitude: 0 }]) await assert.rejects(f.store.ingest(f.report(patch), actor))
  await f.repo.remove('mini_bindings', f.scope.deviceId)
  await assert.rejects(f.store.ingest(f.report(), actor), { code: 'BINDING_CHANGED' })
  assert.equal(await f.repo.get('mini_location_channels', f.scope.deviceId), null)
})
test('缺采集时间：旧固定长度坐标可以收，但不保存坐标/伪造时效/显示有效地图', async () => {
  const f = await locationFixture()
  const r = await f.store.ingest(f.report({ measuredAt: null }), actor)
  assert.equal(r.usable, false); assert.equal(r.reason, 'capture-time-missing')
  const row = await f.repo.get('mini_location_channels', f.scope.deviceId)
  assert.equal(row.position, null); assert(!JSON.stringify(row).includes('120.0001'))
  const snap = await f.call('device.snapshot')
  assert.equal(snap.online, true); assert.equal(snap.location.point, null); assert.equal(snap.location.measuredAt, null)
  assert(snap.locationHint.includes('采集时间')); assert.equal(snap.refreshMode, 'wait-next-report')
})
test('有效采集：真实绑定授权、WGS84 转换一次、精度未知不填零、通话仍关闭', async () => {
  const f = await locationFixture()
  assert.equal((await f.store.ingest(f.report({ accuracyM: null }), actor)).usable, true)
  const snap = await f.call('device.snapshot')
  assert.equal(snap.location.displayable, true); assert.equal(snap.location.coordinateSystem, 'GCJ02')
  assert.notEqual(snap.location.point.longitude, 120.0001); assert.equal(snap.location.accuracyM, null); assert.equal(snap.battery, 73)
  assert.equal(snap.location.expiresAt, f.now() + f.config.statusTtlMs)
  assert.equal(snap.capabilities.voice, false); assert.equal(snap.capabilities.video, false)
  await assert.rejects(f.runtime.dispatch('device.snapshot', { scope: f.scope }, { appid, openid: 'other-parent', source: 'wx-cloudrun-gateway' }), { code: 'FORBIDDEN' })
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, consentActive: false })
  await assert.rejects(f.call('device.snapshot'), { code: 'FORBIDDEN' })
})
test('GCJ02 不重复转换；坐标时间过期不显示', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report({ coordinateSystem: 'GCJ02' }), actor)
  assert.equal((await f.call('device.snapshot')).location.point.longitude, 120.0001)
  f.advance(1)
  const result = await f.store.ingest(f.report({ measuredAt: f.now() - 61000 }), actor)
  // Older GPS sample cannot overwrite a newer one; no fake new fix is created.
  assert.equal(result.reason, 'old-fix')
  f.advance(31000)
  assert.equal((await f.call('device.snapshot')).location.point, null)
})
test('幂等/乱序：重放不续命，同事件不能改内容，迟到事件不恢复断开的定位', async () => {
  const f = await locationFixture(), first = f.report()
  await f.store.ingest(first, actor); f.advance(1000)
  assert.equal((await f.store.ingest(first, actor)).duplicate, true)
  assert.equal((await f.repo.get('mini_location_channels', f.scope.deviceId)).lastSeenAt, first.observedAt)
  await assert.rejects(f.store.ingest({ ...first, battery: 1 }, actor), { code: 'REQUEST_CONFLICT' })
  await f.store.ingest(f.report({ status: 'offline', measuredAt: null, longitude: null, latitude: null }), actor)
  assert.equal((await f.store.ingest(first, actor)).reason, 'out-of-order')
  const snap = await f.call('device.snapshot'); assert.equal(snap.online, false); assert.equal(snap.location.point, null)
})
test('无定位/离线：立即删除旧点与地址，报文中不能夹带旧坐标', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report(), actor); await f.call('device.snapshot'); f.advance(1)
  await assert.rejects(f.store.ingest(f.report({ status: 'no-fix' }), actor), { code: 'INVALID_LOCATION' })
  await f.store.ingest(f.report({ status: 'no-fix', measuredAt: null, latitude: null, longitude: null }), actor)
  assert.equal(await f.repo.get('mini_current_locations', f.scope.deviceId), null)
  const snap = await f.call('device.snapshot'); assert.equal(snap.location.point, null); assert.equal(snap.location.address, null)
  assert(snap.locationHint.includes('未取得有效定位'))
})
test('过期清理：静默后地图不可用；持久化只保留当前点，清理不误删新上报', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report(), actor); await f.call('device.snapshot'); f.advance(31000)
  await f.store.sweep()
  assert.equal((await f.repo.get('mini_location_channels', f.scope.deviceId)).position, null)
  assert.equal(await f.repo.get('mini_current_locations', f.scope.deviceId), null)
  await f.store.ingest(f.report(), actor); await f.store.sweep()
  assert((await f.repo.get('mini_location_channels', f.scope.deviceId)).position)
  assert.equal((await f.repo.list('mini_location_channels', {})).length, 1)
})
test('真实异步竞态：查询已读到旧位置时设备报告无定位，旧响应不能重新落库或返回点位', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report(), actor)
  let release, ready
  const entered = new Promise(resolve => { ready = resolve })
  const provider = createLocationProvider({ store: f.store, config: f.config, now: f.now })
  const get = provider.getLocation
  provider.getLocation = async scope => { const old = await get(scope); ready(); await new Promise(resolve => { release = resolve }); return old }
  const runtime = createRuntime(f.config, { repo: f.repo, now: f.now, provider })
  const pending = runtime.dispatch('device.snapshot', { scope: f.scope }, { ...f.user, source: 'wx-cloudrun-gateway' })
  await entered; f.advance(1)
  await f.store.ingest(f.report({ status: 'no-fix', measuredAt: null, latitude: null, longitude: null }), actor)
  release()
  assert.equal((await pending).location.point, null)
  assert.equal(await f.repo.get('mini_current_locations', f.scope.deviceId), null)
})
test('解绑重绑：旧绑定不写入、新绑定不读取前一孩子位置', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report(), actor)
  const binding = { ...f.binding, bindingVersion: 2, childId: 'next-child' }
  await f.repo.put('mini_bindings', f.scope.deviceId, binding)
  await assert.rejects(f.store.ingest(f.report(), actor), { code: 'BINDING_CHANGED' })
  const provider = createLocationProvider({ store: f.store, config: f.config, now: f.now })
  assert.equal(await provider.getLocation(binding), null)
  assert.equal((await provider.getDevice(binding)).online, false)
})
test('被动刷新：不下发虚假指令、重复查询同一任务、只有新有效采集才能完成', async () => {
  const f = await locationFixture()
  await f.store.ingest(f.report(), actor)
  const a = await f.call('location.refresh', { requestId: 'wait-one' })
  assert.equal(a.state, 'submitted'); assert.equal(a.refreshMode, 'wait-next-report')
  assert.equal((await f.call('location.refresh', { requestId: 'wait-one' })).id, a.id)
  f.advance(1); await f.store.ingest(f.report({ measuredAt: null }), actor)
  assert.equal((await f.call('operation.get', { operationId: a.id })).state, 'submitted')
  f.advance(1); await f.store.ingest(f.report(), actor)
  assert.equal((await f.call('operation.get', { operationId: a.id })).state, 'success')
  const b = await f.call('location.refresh', { requestId: 'wait-two' }); f.advance(10001)
  assert.equal((await f.call('operation.get', { operationId: b.id })).state, 'timeout')
})
async function serve(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return 'http://127.0.0.1:' + server.address().port
}
test('独立 HTTP 接收：验签、持久化确认、大小限制、业务路由隔离及日志脱敏', async t => {
  const f = await locationFixture(), logs = []
  const runtime = createIngressRuntime(f.config, { repo: f.repo, now: f.now })
  const base = await serve(t, createIngressServer({ config: f.config, runtime, now: f.now, log: v => logs.push(v) }))
  const bytes = Buffer.from(JSON.stringify(f.report()))
  async function send(body = bytes, headers = signHeaders(actor.keyId, secret, body, f.now()), path = PATH) { const r = await fetch(base + path, { method: 'POST', headers, body }); return { status: r.status, data: await r.json() } }
  assert.equal((await send()).data.data.usable, true)
  assert.equal((await send(bytes, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await send(bytes, undefined, '/api/gateway')).status, 404)
  const huge = Buffer.from('x'.repeat(17000)); assert.equal((await send(huge)).status, 413)
  const log = JSON.stringify(logs); assert(!log.includes(secret)); assert(!log.includes('120.0001')); assert(!log.includes('test-device'))
  const business = await serve(t, createServer({ config: f.config, runtime: f.runtime }))
  assert.equal((await fetch(business + PATH, { method: 'POST', body: bytes })).status, 404)
})
test('TCP 配置保护：非本机必须 TLS，HTTP 外部转发/URL凭证/未知协议不能启动', () => {
  const base = { host: '127.0.0.1', port: 0, devices: [{ deviceId: 'test-device', token, bindingVersion: 1, framing: 'fixed17', coordinateSystem: 'WGS84' }] }
  assert.equal(validateConfig(base).size, 1)
  assert.throws(() => validateConfig({ ...base, host: '0.0.0.0' }), { code: 'CONFIG_REQUIRED' })
  for (const ingressUrl of ['http://example.com' + PATH, 'https://user:pass@example.com' + PATH, 'https://example.com/api/gateway', 'ftp://example.com' + PATH]) assert.throws(() => createForwarder({ ingressUrl, keyId: actor.keyId, secret }), { code: 'CONFIG_REQUIRED' })
  assert.throws(() => createIngressRuntime({ ...base, ...{} }), { code: 'CONFIG_REQUIRED' })
})
test('真实异步链路：TCP 认证+注册+拆/粘包→签名HTTP→后台→小程序适配，无真实位置上传', async t => {
  const f = await locationFixture(true), logs = []
  const ingress = await serve(t, createIngressServer({ config: f.config, runtime: createIngressRuntime(f.config, { repo: f.repo }), log: v => logs.push(v) }))
  const relay = createTcpRelay({ config: { host: '127.0.0.1', port: 0, ingressUrl: ingress + PATH, keyId: actor.keyId, secret,
    devices: [{ deviceId: 'test-device', token, bindingVersion: 1, framing: 'fixed17', coordinateSystem: 'WGS84' }] }, log: v => logs.push(v) })
  const address = await relay.start(); t.after(() => relay.stop())
  const socket = net.connect(address.port, '127.0.0.1'); socket.on('error', () => {}); t.after(() => socket.destroy())
  await new Promise(resolve => socket.once('connect', resolve))
  let replies = 0; socket.on('data', v => { replies += v.length })
  const input = Buffer.from('AUTH test-device ' + token + '\r\n{"imei":"SYNTHETIC-NOT-AUTH"}120.0001_30.00010120.0002_30.00020')
  socket.write(input.subarray(0, 7)); await tick(); socket.write(input.subarray(7))
  await waitFor(() => logs.filter(x => x.code === 'LOCATION_RECEIVED_NOT_USABLE').length === 2)
  assert.equal(replies, 0)
  assert.equal((await f.call('device.snapshot')).location.point, null)
  assert.equal((await f.repo.list('mini_location_channels', {})).length, 1)
  assert(!JSON.stringify(logs).includes(token)); assert(!JSON.stringify(logs).includes('120.000'))
  socket.end(); await waitFor(() => f.repo.get('mini_location_channels', f.scope.deviceId).then(x => x && !x.online))
})
test('JSONL 接入端到端：真实采集时间协议→TCP→HTTP→微信业务查询→客户端点位与权限', async t => {
  const f = await locationFixture(true)
  const ingress = await serve(t, createIngressServer({ config: f.config, runtime: createIngressRuntime(f.config, { repo: f.repo }) }))
  const business = await serve(t, createServer({ config: f.config, runtime: f.runtime }))
  const relay = createTcpRelay({ config: { host: '127.0.0.1', port: 0, ingressUrl: ingress + PATH, keyId: actor.keyId, secret,
    devices: [{ deviceId: 'test-device', token, bindingVersion: 1, framing: 'jsonl', coordinateSystem: 'WGS84' }] } })
  const addr = await relay.start(); t.after(() => relay.stop())
  const sock = net.connect(addr.port, '127.0.0.1'); sock.on('error', () => {}); t.after(() => sock.destroy())
  await new Promise(resolve => sock.once('connect', resolve))
  sock.write('AUTH test-device ' + token + '\r\n' + JSON.stringify({ version: 1, status: 'valid', measuredAt: Date.now(), longitude: 120.0001, latitude: 30.0001, accuracyM: null, battery: 73 }) + '\r\n')
  await waitFor(() => f.repo.get('mini_location_channels', f.scope.deviceId).then(x => x && x.position))
  let openid = f.user.openid, epoch = 1
  const client = createDeviceClient({ config: { appId: appid, mode: 'cloud', transport: 'cloudrun', requestTimeoutMs: 1000, cloudrun: { enabled: true, envId: 'test-env', serviceName: 'test-business', path: '/api/gateway' } },
    store: { getEpoch: () => epoch, getSession: () => ({ privacyAccepted: true }) }, media: {}, wxApi: { getAccountInfoSync: () => ({ miniProgram: { appId: appid } }), getStorageSync() {}, cloud: { init() {}, async callContainer(v) {
      const r = await fetch(business + v.path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-wx-openid': openid, 'x-wx-appid': appid, 'x-wx-env': 'test-env', 'x-wx-source': 'wx_client' }, body: JSON.stringify(v.data) }); return { statusCode: r.status, data: await r.json() }
    } } } })
  const snap = await client.snapshot(); assert.equal(snap.isDemo, false); assert.equal(snap.status, 'valid'); assert(snap.point)
  assert.equal(snap.accuracy, null); assert.equal(snap.refreshMode, 'wait-next-report'); assert(snap.remainingMs <= 30000)
  await client.watch(false); await client.watch(true)
  const op = await client.refresh(); assert.equal(op.refreshMode, 'wait-next-report'); assert.equal(op.state, 'submitted')
  openid = 'other-parent'; epoch++
  await assert.rejects(client.snapshot(), { code: 'FORBIDDEN' })
  sock.end(); await waitFor(() => f.repo.get('mini_location_channels', f.scope.deviceId).then(x => x && !x.online))
})
test('TCP：错误凭证不转发、不 ACK；固定长度无认证不能混入正式链路', async t => {
  const records = []
  const relay = createTcpRelay({ config: { host: '127.0.0.1', port: 0, devices: [{ deviceId: 'test-device', token, bindingVersion: 1, framing: 'fixed17', coordinateSystem: 'WGS84' }] }, forward: async v => { records.push(v); return { accepted: true, usable: false } } })
  const addr = await relay.start(); t.after(() => relay.stop())
  const socket = net.connect(addr.port, '127.0.0.1'); socket.on('error', () => {})
  await new Promise(resolve => socket.once('connect', resolve))
  const closed = new Promise(resolve => socket.once('close', resolve)); socket.write('120.0001_30.00010\r\n'); await closed
  assert.equal(records.length, 0)
})
