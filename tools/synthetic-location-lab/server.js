'use strict'
// Local-only synthetic reports. Never reads deployment env files or cloud credentials.
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createService } = require('../../cloudfunctions/miniDeviceGateway/lib/service')
const { createLocationStore, createLocationProvider } = require('../../server/mini-device-cloudrun/location-store')
const { createIngressRuntime, createIngressServer } = require('../../server/mini-device-cloudrun/location-ingress')
const { signHeaders, PATH } = require('../../server/mini-device-cloudrun/location-ingest-auth')
const { readBody } = require('../../server/mini-device-cloudrun/server')
const unconfigured = require('../../cloudfunctions/miniDeviceGateway/providers/unconfigured')
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value))
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
function memoryRepository() {
  let rows = new Map(), queue = Promise.resolve()
  const access = {
    async get(c, id) { return copy(rows.get(c + ':' + id) || null) },
    async put(c, id, value) { rows.set(c + ':' + id, copy(value)); return copy(value) },
    async remove(c, id) { rows.delete(c + ':' + id) },
    async list(c, where) { return [...rows].filter(([key, v]) => key.startsWith(c + ':') && Object.entries(where).every(([k, val]) => v[k] === val)).map(([, v]) => copy(v)) }
  }
  return { ...access, health: async () => true, close: async () => { rows.clear() },
    transaction(fn) {
      const job = queue.then(async () => { const before = new Map([...rows].map(([k, v]) => [k, copy(v)])); try { return await fn(access) } catch (e) { rows = before; throw e } })
      queue = job.catch(() => {}); return job
    }
  }
}
async function listen(server, port) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return 'http://127.0.0.1:' + server.address().port
}
async function close(server) { if (server && server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
async function startLab({ port = 18868, clock = Date.now } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('本机端口无效')
  const repo = memoryRepository(), controlToken = crypto.randomBytes(32).toString('hex'), secret = crypto.randomBytes(32).toString('base64url')
  let offset = 0, actionQueue = Promise.resolve(), stopping = false, lastResult = null, session = null, code = '', pairUntil = 0, attempts = 0, attemptAt = clock()
  const history = [], now = () => clock() + offset
  const config = { appid: 'synthetic-local-app', locationTtlMs: 15000, statusTtlMs: 30000, watchLeaseMs: 30000, pollMs: 2000,
    refreshTimeoutMs: 10000, callInviteTimeoutMs: 30000, maxCallMs: 600000,
    locationRelayKeys: JSON.stringify([{ keyId: 'local-sim-relay', secret, deviceIds: ['local_sim_device_a'] }]) }
  const scope = { familyId: 'local_sim_family_a', childId: 'local_sim_role_a', deviceId: 'local_sim_device_a', bindingVersion: 1 }
  const user = { openid: 'local_sim_parent_a', appid: config.appid }
  const member = { ...user, familyId: scope.familyId, childIds: [scope.childId], active: true, consentActive: true,
    permissions: { viewDevice: true, locateDevice: true, callDevice: false } }
  await repo.put('mini_bindings', scope.deviceId, { ...scope, active: true, childName: '虚构角色 S', deviceName: '本机模拟设备 S' })
  await repo.put('mini_memberships', 'local_sim_member_a', member)
  const store = createLocationStore({ repo, config, now })
  const service = createService({ repo, config, now, provider: createLocationProvider({ store, config, now, fallback: unconfigured() }) })
  const ingress = createIngressServer({ config, now, runtime: createIngressRuntime(config, { repo, now }) })
  const ingressUrl = await listen(ingress, 0)
  function pairing() { code = crypto.randomBytes(5).toString('hex').toUpperCase(); pairUntil = clock() + 300000; session = null }
  pairing()
  async function state(admin) {
    await store.sweep()
    const m = await repo.get('mini_memberships', 'local_sim_member_a')
    let snapshot = null, denied = false
    try { snapshot = await service.dispatch('device.snapshot', { scope }, user) }
    catch (e) { if (e.code !== 'FORBIDDEN') throw e; denied = true }
    const channel = await store.channel(scope)
    return { contract: 'ailab-synthetic-location/v1', synthetic: true, cloudConnected: false, storage: 'volatile-memory', serverTime: now(),
      offsetMs: offset, locationTtlMs: config.locationTtlMs, scope, permissionGranted: m.permissions.locateDevice, denied,
      reason: denied ? 'forbidden' : channel && channel.reason || (!channel ? 'waiting' : null), snapshot,
      lastResult, history: history.slice(), ...(admin ? { pairingCode: clock() < pairUntil ? code : '', pairingRemainingMs: Math.max(0, pairUntil - clock()), paired: !!session && session.expiresAt > clock() } : {}) }
  }
  async function action(name) {
    offset += 1 // Ensure consecutive generated samples have distinct capture times.
    let result
    if (name === 'pairing') { pairing(); result = { code: 'PAIRING_READY', message: '新配对码已生成；旧本机查看会话已失效。' } }
    else if (name === 'revoke' || name === 'restore') {
      await repo.put('mini_memberships', 'local_sim_member_a', { ...member, permissions: { ...member.permissions, locateDevice: name === 'restore' } })
      result = { code: name === 'revoke' ? 'LOCAL_REVOKED' : 'LOCAL_RESTORED', message: name === 'revoke' ? '仅撤回本机虚构账号的位置查看权限。' : '仅恢复本机虚构账号的位置查看权限；云端未变。' }
    } else if (name === 'expire') { offset += 16000; await store.sweep(); result = { code: 'TIME_ADVANCED', message: '模拟时钟前进 16 秒；过期点应消失。' } }
    else if (name === 'other-parent') {
      try { await service.dispatch('device.snapshot', { scope }, { ...user, openid: 'local_sim_other_parent' }); fail('CHECK_FAILED', '未授权的虚构账号意外读取成功') }
      catch (e) { if (e.code !== 'FORBIDDEN') throw e; result = { code: 'FORBIDDEN', expectedDenial: true, message: '另一虚构账号被拒绝，未返回坐标。' } }
    } else if (['point-a', 'point-b', 'no-fix', 'offline', 'bad-signature', 'old-binding'].includes(name)) {
      const valid = !['no-fix', 'offline'].includes(name)
      const report = { version: 1, eventId: crypto.randomUUID(), deviceId: scope.deviceId, bindingVersion: name === 'old-binding' ? 2 : 1,
        observedAt: now(), measuredAt: valid ? now() : null, status: valid ? 'valid' : name, coordinateSystem: 'GCJ02', accuracyM: null, battery: 73,
        ...(valid ? { longitude: name === 'point-b' ? 120.0004 : 120.0001, latitude: name === 'point-b' ? 30.0003 : 30.0001 } : {}) }
      const bytes = Buffer.from(JSON.stringify(report)), headers = signHeaders('local-sim-relay', secret, bytes, now())
      if (name === 'bad-signature') headers['x-location-signature'] = '0'.repeat(64)
      const response = await fetch(ingressUrl + PATH, { method: 'POST', headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(5000) })
      const body = await response.json(), expected = { 'bad-signature': 'AUTH_REQUIRED', 'old-binding': 'BINDING_CHANGED' }[name]
      if (expected) {
        if (body.ok !== false || body.error.code !== expected) fail('CHECK_FAILED', '拒绝检查未符合预期')
        result = { code: expected, expectedDenial: true, message: name === 'bad-signature' ? '错误签名已被接收接口拒绝，没有写入。' : '不匹配的绑定版本已被拒绝，没有写入。' }
      } else {
        if (body.ok !== true || body.data.accepted !== true) fail('REPORT_FAILED', '测试报文未被接收，请重试')
        result = { code: 'REPORT_ACCEPTED', usable: body.data.usable, message: valid ? '签名报文已接收并写入本机临时存储。' : name === 'offline' ? '离线报文已接收，旧点已清除。' : '无定位报文已接收，旧点已清除。' }
      }
    } else fail('INVALID_ACTION', '仅支持预设的虚构测试场景')
    lastResult = { ...result, action: name, at: now() }
    history.unshift(lastResult); history.splice(8)
    return state(true)
  }
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/view.js': ['../../miniprogram/services/device/synthetic-view.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] }
  let base
  const server = http.createServer(async (req, res) => {
    function send(status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(data)) }
    try {
      if (stopping) fail('STOPPING', '本机工具正在关闭')
      if (req.headers.host !== new URL(base).host || req.headers.origin && req.headers.origin !== base) fail('FORBIDDEN', '仅允许本机专用页面请求')
      if (req.method === 'GET' && files[req.url]) {
        const [file, type] = files[req.url]
        const content = fs.readFileSync(path.join(__dirname, file), 'utf8').replace('__CONTROL_TOKEN__', controlToken)
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(content); return
      }
      const offered = req.headers['x-sim-token'], admin = same(offered, controlToken)
      const paired = session && session.expiresAt > clock() && same(offered, session.token)
      if (req.url === '/api/state' && req.method === 'GET') {
        if (!admin && !paired) fail('UNPAIRED', '本机会话未配对或已失效')
        send(200, { ok: true, data: await state(admin) }); return
      }
      if (req.method !== 'POST' || !['/api/action', '/api/pair', '/api/unpair'].includes(req.url)) { send(404, { ok: false, error: { code: 'NOT_FOUND', message: '没有这个本机接口' } }); return }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('INVALID_ARGUMENT', '请发送 JSON')
      if (req.url === '/api/action' && (!admin || req.headers.origin !== base)) fail('FORBIDDEN', '只有本机控制页可以发送模拟报文')
      if (req.url === '/api/unpair' && !paired) fail('UNPAIRED', '本机会话已失效')
      const body = await readBody(req)
      if (!body || Array.isArray(body) || typeof body !== 'object') fail('INVALID_ARGUMENT', '参数错误')
      if (req.url === '/api/pair') {
        if (clock() - attemptAt >= 60000) { attempts = 0; attemptAt = clock() }
        if (++attempts > 10) fail('RATE_LIMIT', '配对过于频繁，请一分钟后重试')
        if (Object.keys(body).some(k => k !== 'code') || !/^[A-F0-9]{10}$/.test(body.code || '') || clock() >= pairUntil || !same(body.code, code)) fail('PAIR_INVALID', '配对码错误、已使用或过期')
        code = ''; pairUntil = 0
        session = { token: crypto.randomBytes(32).toString('hex'), expiresAt: clock() + 1800000 }
        send(200, { ok: true, data: { ...session, contract: 'ailab-synthetic-location/v1' } }); return
      }
      if (req.url === '/api/unpair') { session = null; send(200, { ok: true, data: { unpaired: true } }); return }
      if (Object.keys(body).some(k => k !== 'action') || typeof body.action !== 'string') fail('INVALID_ARGUMENT', '只允许选择预设场景，不接收个人数据')
      const job = actionQueue.then(() => action(body.action)); actionQueue = job.catch(() => {})
      send(200, { ok: true, data: await job })
    } catch (e) {
      const known = ['FORBIDDEN', 'UNPAIRED', 'PAIR_INVALID', 'RATE_LIMIT', 'INVALID_ARGUMENT', 'INVALID_ACTION', 'INVALID_JSON', 'PAYLOAD_TOO_LARGE', 'REQUEST_TIMEOUT', 'REPORT_FAILED', 'CHECK_FAILED', 'STOPPING'].includes(e.code)
      send(known ? 400 : 500, { ok: false, error: { code: known ? e.code : 'LOCAL_ERROR', message: known ? e.message : '本机测试暂不可用，不回退演示结果' } })
    } finally { if (!req.complete) req.resume() }
  })
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000
  try { base = await listen(server, port) } catch (e) { await close(ingress); await repo.close(); throw e }
  return { base, async stop() { stopping = true; session = null; code = ''; await close(server); await actionQueue; await close(ingress); await repo.close() } }
}
module.exports = { startLab }
if (require.main === module) {
  startLab().then(lab => {
    console.info('本机模拟定位台：' + lab.base + '（仅虚构数据 / 临时内存 / 无云端连接）')
    let closing = false
    const stop = () => { if (!closing) { closing = true; lab.stop().then(() => { console.info('本机测试已停止，临时数据已清空'); process.exit(0) }) } }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  }).catch(e => { console.error(e.code === 'EADDRINUSE' ? '18868 端口已被占用；未关闭或覆盖已有服务' : '本机模拟定位台启动失败'); process.exitCode = 1 })
}
