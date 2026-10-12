const test = require('node:test')
const assert = require('node:assert/strict')
const { readConfig } = require('../server/mini-device-cloudrun/config')
const { gatewayIdentity } = require('../server/mini-device-cloudrun/auth')
const { createRuntime } = require('../server/mini-device-cloudrun/runtime')
const { createServer } = require('../server/mini-device-cloudrun/server')
const { mysqlRepository, createRepository } = require('../server/mini-device-cloudrun/repository')
const { createDeviceTransport } = require('../miniprogram/services/device/transport')
const { createDeviceSetup } = require('../miniprogram/services/device/setup')
const { createDeviceClient } = require('../miniprogram/services/device/client')
const { fixture } = require('./fixtures/device-integration')
const appid = 'wxc5abf3407ed4ef30'
const config = () => readConfig({ MINI_APP_ID: appid, WX_CLOUDRUN_ENV: 'test-cloudrun', WX_GATEWAY_ONLY_CONFIRMED: 'true' })
const headers = () => ({ 'x-wx-appid': appid, 'x-wx-openid': 'test-parent-a', 'x-wx-source': 'wx_client', 'x-wx-env': 'test-cloudrun', 'content-type': 'application/json' })
const clientConfig = () => ({ appId: appid, mode: 'cloud', transport: 'cloudrun', requestTimeoutMs: 100, cloudrun: { enabled: true, envId: 'test-cloudrun', serviceName: 'ailab-device-gateway', path: '/api/gateway' } })
test('云托管身份：未经网络隔离确认，即使提交全套伪造 headers 也拒绝', () => {
  assert.throws(() => gatewayIdentity(headers(), readConfig({ WX_CLOUDRUN_ENV: 'test-cloudrun' })), { code: 'AUTH_NOT_CONFIGURED' })
})
test('云托管身份：缺少来源/本人身份、其他环境/AppID、重复头或跨应用复用拒绝', () => {
  for (const h of [{ ...headers(), 'x-wx-source': '' }, { ...headers(), 'x-wx-openid': '' }, { ...headers(), 'x-wx-env': 'another' }, { ...headers(), 'x-wx-appid': 'another' }, { ...headers(), 'x-wx-openid': ['a', 'b'] }, { ...headers(), 'x-wx-openid': 'a,b' }, { ...headers(), 'x-wx-from-appid': appid }]) assert.throws(() => gatewayIdentity(h, config()), { code: 'AUTH_REQUIRED' })
  assert.equal(gatewayIdentity(headers(), config()).openid, 'test-parent-a')
})
async function httpFixture(t, options = {}) {
  const c = options.config || config(), runtime = options.runtime || createRuntime(c), logs = []
  const server = createServer({ config: c, runtime, log: item => logs.push(item) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(body, h = headers(), path = '/api/gateway', method = 'POST') {
    const r = await fetch(base + path, { method, headers: h, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
    return { status: r.status, body: await r.json(), headers: r.headers }
  }
  return { request, logs }
}
test('HTTP：健康检查只证明进程存活；无数据库也能查本人，设备读取不能回退示例', async t => {
  const f = await httpFixture(t)
  const h = await f.request(null, {}, '/healthz', 'GET'); assert.equal(h.status, 200); assert.equal(h.body.data.businessVerified, false)
  const identity = await f.request({ action: 'identity.get', payload: { openid: 'forged', role: 'admin' } })
  assert.equal(identity.body.data.openid, 'test-parent-a'); assert.equal(identity.body.data.source, 'wx-cloudrun-gateway')
  const health = await f.request({ action: 'system.health' }); assert.equal(health.body.data.storageReady, false); assert.equal(health.body.data.mediaVerified, false)
  const target = await f.request({ action: 'context.list' }); assert.equal(target.status, 503); assert.equal(target.body.error.code, 'STORAGE_NOT_CONFIGURED')
  assert.equal(identity.headers.get('cache-control'), 'no-store')
  const logs = JSON.stringify(f.logs); assert(!logs.includes('test-parent-a')); assert(!logs.includes('forged'))
})
test('HTTP：匿名、公网无上下文、错误路由、原生回调、GET 业务、未知 action 都明确失败', async t => {
  const f = await httpFixture(t)
  assert.equal((await f.request({ action: 'identity.get', payload: { openid: 'forged' } }, {})).status, 401)
  assert.equal((await f.request({}, headers(), '/api/count')).status, 404)
  assert.equal((await f.request({}, headers(), '/device/callback')).status, 404)
  assert.equal((await f.request(null, headers(), '/api/gateway', 'GET')).status, 405)
  for (const action of ['__proto__', 'toString', 'admin.grant', 'deviceEvent', 'maintenance']) assert.equal((await f.request({ action })).body.error.code, 'INVALID_ACTION')
})
test('HTTP：非法 JSON/数组参数/过大请求拒绝，内部异常不暴露原始内容', async t => {
  const f = await httpFixture(t)
  assert.equal((await f.request('{bad')).body.error.code, 'INVALID_JSON')
  assert.equal((await f.request({ action: 'identity.get', payload: [] })).body.error.code, 'INVALID_ARGUMENT')
  assert.equal((await f.request({ action: 'identity.get', payload: { value: 'x'.repeat(17000) } })).status, 413)
  const bad = await httpFixture(t, { runtime: { async dispatch() { throw Error('SQL password and precise-location') }, async close() {} } })
  const r = await bad.request({ action: 'identity.get' }); assert.equal(r.status, 500); assert(!JSON.stringify(r.body).includes('password'))
})
test('HTTP：可信身份仍需后台家庭/孩子/权限核验，伪造管理员不授予权限', async t => {
  const f = await fixture(), repo = { ...f.repo, health: async () => true, close: async () => {} }
  const runtime = createRuntime({ ...config(), ...f.config }, { repo, provider: f.provider, now: f.now })
  const h = await httpFixture(t, { runtime })
  assert.equal((await h.request({ action: 'context.list' })).body.data.length, 1)
  const other = await h.request({ action: 'context.list', payload: { openid: f.user.openid, role: 'admin' } }, { ...headers(), 'x-wx-openid': 'other-parent' })
  assert.deepEqual(other.body.data, [])
  const cross = await h.request({ action: 'device.snapshot', payload: { scope: { ...f.scope, childId: 'another-child' }, role: 'admin' } })
  assert.equal(cross.body.error.code, 'BINDING_CHANGED')
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, permissions: { viewDevice: true, locateDevice: false } })
  const denied = await h.request({ action: 'device.snapshot', payload: { scope: f.scope, role: 'admin', permissions: { locateDevice: true } } })
  assert.equal(denied.status, 403); assert.equal(denied.body.error.code, 'FORBIDDEN')
})
test('配置：本阶段强制关闭真实媒体/回调；未核实明文公网 MySQL 不能配置', () => {
  const c = readConfig({ MEDIA_STATE_RELAY_READY: 'true', CALLBACK_PROTOCOL: 'hmac-v1' })
  assert.equal(c.mediaStateRelayReady, false); assert.equal(c.callbackProtocol, 'disabled')
  assert.throws(() => createRepository({ storageDriver: 'mysql', mysql: { host: 'db', port: 3306, user: 'user', password: 'placeholder', database: 'db', tls: false } }), { code: 'CONFIG_REQUIRED' })
})
function sqlFake() {
  const queries = [], events = []
  let fail = false, rows = [{ record_id: 'device', data: { active: true } }]
  const execute = async (options, args) => { const sql = options.sql; assert.equal(options.timeout, 5000); queries.push({ sql, args }); if (fail) throw { code: 'ER_SECRET', message: 'password' }; if (sql.includes('mutex')) return [[{ id: 1 }]]; return [rows] }
  const client = { execute, async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') }, release() { events.push('release') } }
  const pool = { execute, async getConnection() { return client }, async end() { events.push('close') } }
  return { repo: mysqlRepository(pool), queries, events, rows(v) { rows = v }, fail(v) { fail = v } }
}
test('MySQL 适配：参数化查询、无自动示例导入、记录 ID/集合与查询条件校验', async () => {
  const f = sqlFake()
  await f.repo.put('mini_bindings', 'device', { deviceId: 'device', _id: 'remove', value: "a' OR 1=1" })
  assert(!f.queries[0].sql.includes('OR 1=1')); assert(f.queries[0].args[2].includes('OR 1=1')); assert(!f.queries[0].args[2].includes('remove'))
  assert.equal((await f.repo.get('mini_bindings', 'device'))._id, 'device')
  await f.repo.list('mini_memberships', { openid: "a' OR 1=1", active: true }); assert(f.queries.at(-1).sql.includes('JSON_CONTAINS'))
  await assert.rejects(f.repo.get('unknown', 'id'), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(f.repo.get('mini_bindings', '../id'), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(f.repo.list('mini_memberships', { $where: 'sql' }), { code: 'INVALID_ARGUMENT' })
  f.rows([]); assert.equal(await f.repo.get('mini_bindings', 'device'), null)
})
test('MySQL 适配：事务锁、提交与失败回滚，连接总会释放，错误不含 SQL/密码', async () => {
  const f = sqlFake()
  await f.repo.transaction(tx => tx.put('mini_bindings', 'device', { active: true }))
  assert(f.queries.some(q => q.sql.includes('FOR UPDATE'))); assert.deepEqual(f.events, ['begin', 'commit', 'release'])
  await assert.rejects(f.repo.transaction(async () => { throw { code: 'FORBIDDEN', message: '没有权限' } }), { code: 'FORBIDDEN' })
  assert.deepEqual(f.events.slice(-3), ['begin', 'rollback', 'release'])
  f.fail(true); assert.equal(await f.repo.health(), false)
  await assert.rejects(f.repo.get('mini_bindings', 'device'), e => e.code === 'STORAGE_UNAVAILABLE' && !e.message.includes('password'))
})
test('MySQL 适配：初始化不完整或关系超过限制时不伪装可用', async () => {
  const f = sqlFake(); f.rows(Array.from({ length: 1001 }, () => ({ record_id: 'a', data: {} })))
  await assert.rejects(f.repo.list('mini_memberships', {}), { code: 'RELATION_LIMIT' })
  const noLock = mysqlRepository({ async execute() { return [[]] } }); assert.equal(await noLock.health(), false)
})
function wxFixture(c = clientConfig()) {
  const calls = [], inits = [], writes = [], session = { privacyAccepted: true }; let epoch = 1
  let handler = async data => ({ statusCode: 200, data: { ok: true, data: data.action === 'identity.get' ? { appid, openid: '本人', source: 'wx-cloudrun-gateway', isDemo: false } : { contract: 'ailab-mini-device/v1', appid, source: 'wx-cloudrun-gateway', storageReady: false, isDemo: false } } })
  const wxApi = { getAccountInfoSync: () => ({ miniProgram: { appId: appid } }), setStorageSync(...v) { writes.push(v) }, getStorageSync() {}, cloud: { init(v) { inits.push(v) }, async callContainer(v) { calls.push(v); return handler(v.data) } } }
  const store = { getEpoch: () => epoch, getSession: () => session }
  return { config: c, wxApi, store, calls, inits, writes, session, bump() { epoch++ }, handle(fn) { handler = fn }, setup: createDeviceSetup({ config: c, wxApi, store }) }
}
test('客户端：callContainer 使用独立服务/路径和环境，不发送 OpenID/角色、不使用公网 URL', async () => {
  const f = wxFixture(); assert.equal((await f.setup.getIdentity()).openid, '本人')
  assert.equal(f.calls[0].config.env, 'test-cloudrun'); assert.equal(f.calls[0].header['X-WX-SERVICE'], 'ailab-device-gateway')
  assert.deepEqual(f.calls[0].data, { action: 'identity.get', payload: {} }); assert(!f.inits[0].env); assert.equal(f.writes.length, 0)
  assert.equal((await f.setup.checkConnection()).storageReady, false)
})
const readOnlyBinding = () => ({ familyId: 'qa-family', childId: 'qa-child', deviceId: 'qa-device', bindingVersion: 3,
  child: { id: 'qa-child', name: '虚构角色 A' }, deviceName: '虚构设备 A', permissions: { viewDevice: true, locateDevice: false, callDevice: false } })
test('只读云端列表：只请求 context.list，不发送身份、不触发设备服务、不保存结果', async () => {
  const f = wxFixture(); f.config.mode = 'demo'
  f.handle(async () => ({ statusCode: 200, data: { ok: true, data: [{ ...readOnlyBinding(), privateField: 'must-not-display' }] } }))
  const rows = await f.setup.bindings()
  assert.equal(rows.length, 1); assert.equal(rows[0].childName, '虚构角色 A')
  assert.deepEqual(rows[0].permissions, { viewDevice: true, locateDevice: false, callDevice: false })
  assert.equal(rows[0].privateField, undefined)
  assert.deepEqual(f.calls.map(c => c.data), [{ action: 'context.list', payload: {} }])
  assert.equal(f.writes.length, 0)
  f.handle(async () => ({ statusCode: 200, data: { ok: true, data: [] } }))
  assert.deepEqual(await f.setup.bindings(), [])
})
test('只读云端列表：异常结构、权限、重复记录和失效绑定不能显示为成功', async () => {
  const f = wxFixture(), row = readOnlyBinding()
  for (const data of [{}, [null], [{ ...row, childId: '../child' }], [{ ...row, bindingVersion: 0 }],
    [{ ...row, child: { id: 'other-child', name: '错误角色' } }], [{ ...row, permissions: { viewDevice: false } }],
    [{ ...row, permissions: { viewDevice: true, locateDevice: 'true' } }], [row, row], Array(1001).fill(row)]) {
    f.handle(async () => ({ statusCode: 200, data: { ok: true, data } }))
    await assert.rejects(f.setup.bindings(), { code: 'INVALID_RESPONSE' })
  }
  f.handle(async () => ({ statusCode: 403, data: { ok: false, error: { code: 'FORBIDDEN', message: '无权限' } } }))
  await assert.rejects(f.setup.bindings(), { code: 'FORBIDDEN' })
})
test('只读云端列表：隐私未同意、退出后迟到响应和超时均拒绝', async () => {
  const f = wxFixture(); f.session.privacyAccepted = false
  await assert.rejects(f.setup.bindings(), { code: 'PRIVACY_REQUIRED' }); assert.equal(f.calls.length, 0)
  f.session.privacyAccepted = true; let release
  f.handle(() => new Promise(resolve => { release = resolve }))
  const pending = f.setup.bindings(); f.bump()
  release({ statusCode: 200, data: { ok: true, data: [readOnlyBinding()] } })
  await assert.rejects(pending, { code: 'STALE_CONTEXT' })
  f.config.requestTimeoutMs = 10; f.handle(() => new Promise(() => {}))
  await assert.rejects(f.setup.bindings(), { code: 'REQUEST_TIMEOUT' })
  assert.equal(f.writes.length, 0)
})
test('只读列表本机 HTTP 链路：无设备平台仍能查授权，其他家长为空，撤权后立即为空', async t => {
  const f = await fixture(), w = wxFixture()
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, permissions: { viewDevice: true, locateDevice: false, callDevice: false } })
  const repo = { ...f.repo, health: async () => true, close: async () => {} }
  const runtime = createRuntime(config(), { repo })
  const server = await httpFixture(t, { runtime })
  let actor = headers()
  w.wxApi.cloud.callContainer = async request => { const r = await server.request(request.data, actor); return { statusCode: r.status, data: r.body } }
  assert.equal((await w.setup.bindings())[0].deviceId, f.scope.deviceId)
  actor = { ...headers(), 'x-wx-openid': 'other-adult-test-user' }
  assert.deepEqual(await w.setup.bindings(), [])
  actor = headers()
  await f.repo.put('mini_memberships', 'member-a', { ...f.member, active: false })
  assert.deepEqual(await w.setup.bindings(), [])
})
test('客户端：未部署启用、Django 计数模板、缺 SDK/错误 AppID 都阻断', async () => {
  for (const patch of [{ enabled: false }, { envId: '' }, { serviceName: 'django-dmgd' }, { path: '/api/count' }]) {
    const c = clientConfig(); Object.assign(c.cloudrun, patch); const f = wxFixture(c)
    await assert.rejects(f.setup.getIdentity(), { code: 'CONFIG_REQUIRED' }); assert.equal(f.calls.length, 0)
  }
  const f = wxFixture(); f.wxApi.cloud.callContainer = undefined; await assert.rejects(f.setup.getIdentity(), { code: 'CLOUD_UNAVAILABLE' })
  const g = wxFixture(); g.wxApi.getAccountInfoSync = () => ({ miniProgram: { appId: 'wrong' } }); await assert.rejects(g.setup.getIdentity(), { code: 'APPID_MISMATCH' })
})
test('客户端：HTML/模板计数/HTTP 假成功/错误来源不能显示连接或身份成功', async () => {
  const f = wxFixture()
  for (const response of [{ statusCode: 200, data: '<html/>' }, { statusCode: 200, data: { count: 1 } }, { statusCode: 503, data: { ok: true, data: {} } }]) {
    f.handle(async () => response); await assert.rejects(f.setup.getIdentity(), { code: 'INVALID_RESPONSE' })
  }
  f.handle(async () => ({ statusCode: 200, data: { ok: true, data: { appid, openid: 'fake', source: 'wx-cloud-context', isDemo: false } } }))
  await assert.rejects(f.setup.getIdentity(), { code: 'INVALID_IDENTITY' })
})
test('客户端：JSON 字符串和服务端权限错误正常解析，不回退 mock', async () => {
  const f = wxFixture()
  f.handle(async () => ({ statusCode: 403, data: JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: '无权限' } }) }))
  await assert.rejects(f.setup.getIdentity(), { code: 'FORBIDDEN' })
  f.handle(async () => { throw Error('SDK secret') }); await assert.rejects(f.setup.getIdentity(), { code: 'NETWORK_ERROR' }); assert.equal(f.writes.length, 0)
})
test('客户端：隐私拒绝、请求超时和退出后的迟到身份不能写内存或缓存', async () => {
  const f = wxFixture(); f.session.privacyAccepted = false
  await assert.rejects(f.setup.getIdentity(), { code: 'PRIVACY_REQUIRED' }); assert.equal(f.calls.length, 0)
  f.session.privacyAccepted = true; let release
  f.handle(() => new Promise(resolve => { release = resolve }))
  const p = f.setup.getIdentity(); await new Promise(resolve => setImmediate(resolve)); f.bump(); f.setup.invalidate()
  release({ statusCode: 200, data: { ok: true, data: { appid, openid: 'late', source: 'wx-cloudrun-gateway', isDemo: false } } })
  await assert.rejects(p, { code: 'STALE_CONTEXT' }); assert.equal(f.setup.peekIdentity(), null)
  f.config.requestTimeoutMs = 10; f.handle(() => new Promise(() => {})); await assert.rejects(f.setup.getIdentity(), { code: 'REQUEST_TIMEOUT' })
})
test('客户端：云托管模式不恢复另一服务或旧云函数的本地通话指针', async () => {
  const f = wxFixture(); f.wxApi.getStorageSync = () => ({ callId: 'old-call', scope: {}, envId: 'test-cloudrun' })
  f.handle(async data => ({ statusCode: 200, data: { ok: true, data: data.action === 'context.list' ? [{ deviceId: 'd', familyId: 'f', childId: 'c', bindingVersion: 1, child: { name: '孩子' } }] : null } }))
  const client = createDeviceClient({ config: f.config, store: f.store, wxApi: f.wxApi, media: {} })
  await client.loadTargets(); await client.getCall()
  assert(f.calls.some(x => x.data.action === 'call.current')); assert(!f.calls.some(x => x.data.action === 'call.get'))
})
test('云托管端到端本地替身：真实异步 HTTP → SDK 适配 → 身份/健康/权限响应', async t => {
  const server = await httpFixture(t), f = wxFixture()
  f.wxApi.cloud.callContainer = async input => {
    const response = await server.request(input.data)
    return { statusCode: response.status, data: response.body }
  }
  assert.equal((await f.setup.getIdentity()).openid, 'test-parent-a')
  assert.equal((await f.setup.checkConnection()).storageReady, false)
  await assert.rejects(createDeviceTransport({ config: f.config, wxApi: f.wxApi }).invoke('context.list').then(x => { if (!x.result.ok) throw x.result.error }), { code: 'STORAGE_NOT_CONFIGURED' })
})
test('云托管通话：准备结果超时后才返回，仍补发原会话结束，不启动媒体', async () => {
  const f = await fixture(), w = wxFixture(); w.config.requestTimeoutMs = 10
  let release, creates = 0
  w.handle(async data => {
    const result = await f.service.dispatch(data.action, data.payload, f.user)
    if (data.action === 'call.prepare') await new Promise(resolve => { release = resolve })
    return { statusCode: 200, data: { ok: true, data: result } }
  })
  const client = createDeviceClient({ config: w.config, store: w.store, wxApi: w.wxApi, media: { ensure() {}, stop() {}, create() { creates++ } } })
  await assert.rejects(client.start('voice'), { code: 'REQUEST_TIMEOUT' })
  release(); await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(f.controls.ends.length, 1); assert.equal(creates, 0)
})
test('部署包：明确白名单不含本机数据、凭证文件、小程序和测试样本', () => {
  const files = require('../scripts/package-cloudrun').sources()
  assert(files.includes('server/mini-device-cloudrun/package-lock.json'))
  assert(!files.some(f => /^(miniprogram|tests|output)\//.test(f) || /^tools\//.test(f) && f !== 'tools/mini-location-tcp/protocol.js' || /\/\.env$/.test(f)))
})
test('部署包：网页上传根目录包含 Dockerfile，仍保留共享业务代码构建上下文', () => {
  const fs = require('node:fs'), path = require('node:path')
  const { sources, entries } = require('../scripts/package-cloudrun')
  const files = entries(), allowed = new Set(sources())
  assert.equal(new Set(files.map(x => x.file)).size, files.length)
  assert(files.every(x => allowed.has(x.source)))
  assert.deepEqual(files.find(x => x.file === 'Dockerfile'), { file: 'Dockerfile', source: 'server/mini-device-cloudrun/Dockerfile' })
  for (const file of ['server/mini-device-cloudrun/server.js', 'cloudfunctions/miniDeviceGateway/lib/service.js', 'tools/mini-location-tcp/protocol.js']) {
    assert(files.some(x => x.file === file))
  }
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../server/mini-device-cloudrun/Dockerfile'), 'utf8')
  assert(dockerfile.includes('COPY server/mini-device-cloudrun/package*.json ./'))
  assert(dockerfile.includes('PORT=8080'))
})
test('体验设置：打开不自动查身份/云端；连接结果分层，失败与撤权清除旧成功', async t => {
  const old = { wx: global.wx, Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages }
  require('./helpers').createWxMock()
  const api = require('../miniprogram/services/api'), store = require('../miniprogram/services/store')
  const previous = { getLabInfo: api.getLabInfo, checkCloudConnection: api.checkCloudConnection }
  let definition, requests = 0
  api.getLabInfo = () => ({ checks: [] })
  api.checkCloudConnection = async () => { requests++; return { storageReady: false } }
  global.Page = v => { definition = v }
  delete require.cache[require.resolve('../miniprogram/pages/my/debug')]
  require('../miniprogram/pages/my/debug')
  t.after(() => { Object.assign(api, previous); Object.assign(global, old) })
  store.init(); store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: false })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data, p) } }
  global.getCurrentPages = () => [page]
  page.onShow(); assert.equal(requests, 0)
  const healthCheck = page.checkCloudConnection()
  assert.equal(page.data.busy, true); assert.equal(page.data.activeRealAction, 'connection'); assert.equal(page.data.cloudConnection, null)
  await healthCheck; assert.equal(requests, 1); assert.equal(page.data.cloudConnection.storageReady, false); assert(page.data.realResult.includes('数据库未准备好')); assert.equal(page.data.busy, false)
  api.checkCloudConnection = async () => { throw { code: 'NETWORK_ERROR', message: '网络错误' } }
  await page.checkCloudConnection(); assert.equal(page.data.cloudConnection, null); assert.equal(page.data.cloudConnectionError, '网络错误')
  api.checkCloudConnection = async () => { throw { code: 'REQUEST_TIMEOUT', message: 'old generic message' } }
  await page.checkCloudConnection(); assert.match(page.data.cloudConnectionError, /连接检查超时/); assert.equal(page.data.busy, false)
  api.checkCloudConnection = async () => ({ storageReady: true })
  await page.checkCloudConnection(); assert.equal(page.data.cloudConnectionError, ''); assert.equal(page.data.cloudConnection.storageReady, true)
  page.data.realIdentity = { openid: 'old-user' }; store.setSession({ privacyAccepted: false }); page.reload()
  assert.equal(page.data.realIdentity, null); assert.equal(page.data.cloudConnectionError, ''); page.onUnload()
})
test('只读验证页面：手动读取、空结果、失败、重新进入和撤权均清除旧设备', async t => {
  const old = { wx: global.wx, Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages }
  require('./helpers').createWxMock()
  const api = require('../miniprogram/services/api'), store = require('../miniprogram/services/store')
  const previous = { getLabInfo: api.getLabInfo, getCloudBindings: api.getCloudBindings }
  let definition, requests = 0
  api.getLabInfo = () => ({ checks: [] })
  api.getCloudBindings = async () => { requests++; return [readOnlyBinding()] }
  global.Page = v => { definition = v }
  delete require.cache[require.resolve('../miniprogram/pages/my/debug')]
  require('../miniprogram/pages/my/debug')
  t.after(() => { Object.assign(api, previous); Object.assign(global, old) })
  store.init(); store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: false })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data, p) } }
  global.getCurrentPages = () => [page]
  page.onShow(); assert.equal(requests, 0); assert.equal(page.data.cloudBindings, null)
  await page.loadCloudBindings(); assert.equal(requests, 1); assert.equal(page.data.cloudBindings.length, 1)
  api.getCloudBindings = async () => []
  await page.loadCloudBindings(); assert.deepEqual(page.data.cloudBindings, [])
  api.getCloudBindings = async () => { throw { code: 'NETWORK_ERROR', message: '读取失败' } }
  page.data.cloudBindings = [readOnlyBinding()]
  await page.loadCloudBindings(); assert.equal(page.data.cloudBindings, null); assert.equal(page.data.realResult, '读取失败')
  page.data.cloudBindings = [readOnlyBinding()]; page.onShow(); assert.equal(page.data.cloudBindings, null)
  page.data.cloudBindings = [readOnlyBinding()]; store.setSession({ privacyAccepted: false }); page.reload()
  assert.equal(page.data.cloudBindings, null); page.onUnload()
})
test('体验设置：切换身份或离开再返回，不接受迟到云结果，操作按钮可以恢复', async t => {
  const old = { wx: global.wx, Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages }
  require('./helpers').createWxMock()
  const api = require('../miniprogram/services/api'), store = require('../miniprogram/services/store')
  const previous = { getLabInfo: api.getLabInfo, checkCloudConnection: api.checkCloudConnection }
  api.getLabInfo = () => ({ checks: [] })
  let definition, release
  api.checkCloudConnection = () => new Promise(resolve => { release = resolve })
  global.Page = v => { definition = v }
  delete require.cache[require.resolve('../miniprogram/pages/my/debug')]; require('../miniprogram/pages/my/debug')
  t.after(() => { Object.assign(api, previous); Object.assign(global, old) })
  store.init(); store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: false })
  const page = { ...definition, data: { ...definition.data }, setData(p) { Object.assign(this.data, p) } }
  global.getCurrentPages = () => [page]
  page.onShow()
  const changed = page.checkCloudConnection()
  store.setSession({ privacyAccepted: false })
  release({ storageReady: true }); await changed
  assert.equal(page.data.busy, false); assert.equal(page.data.cloudConnection, null)
  store.setSession({ privacyAccepted: true })
  const late = page.checkCloudConnection()
  page.onHide(); page.onShow()
  release({ storageReady: true }); await late
  assert.equal(page.data.busy, false); assert.equal(page.data.cloudConnection, null)
  api.checkCloudConnection = async () => ({ storageReady: true })
  await page.checkCloudConnection(); assert.equal(page.data.cloudConnection.storageReady, true)
  page.onUnload()
})
