const http = require('node:http')
const crypto = require('node:crypto')
const { readConfig } = require('./config')
const { createRuntime } = require('./runtime')
const { gatewayIdentity } = require('./auth')
const { fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const LIMIT = 16384
const SAFE_CODES = new Set(['AUTH_REQUIRED', 'AUTH_NOT_CONFIGURED', 'FORBIDDEN', 'CONFIG_REQUIRED', 'STORAGE_NOT_CONFIGURED', 'STORAGE_UNAVAILABLE', 'INVALID_ACTION', 'INVALID_ARGUMENT', 'RELATION_LIMIT', 'SCOPE_REQUIRED', 'BINDING_CHANGED', 'NOT_FOUND', 'DEVICE_OFFLINE', 'UNSUPPORTED', 'MEDIA_NOT_CONFIGURED', 'MEDIA_NOT_VERIFIED', 'PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'CALL_ACTIVE', 'CALL_BUSY', 'CALL_EXPIRED', 'ROOM_CONFLICT', 'CONSENT_REQUIRED', 'WATCH_ENDED', 'OLD_FIX', 'INVALID_LOCATION', 'INVALID_RESPONSE', 'INVITE_UNCONFIRMED', 'AUTH_INTENT_EXPIRED', 'AUTH_SYNC_UNCONFIRMED', 'PAYLOAD_TOO_LARGE', 'INVALID_JSON', 'REQUEST_TIMEOUT'])
;['PROVIDER_ACCOUNT_REQUIRED', 'PROVIDER_ACCOUNT_CONFLICT', 'PROVIDER_SESSION_EXPIRED', 'PROVIDER_DEVICE_FORBIDDEN', 'PROVIDER_RESPONSE_INVALID', 'PROVIDER_REJECTED', 'WECHAT_LINK_REQUIRED', 'OPENID_MISMATCH', 'WX_VOIP_NOT_CONFIGURED', 'WX_VOIP_API_FAILED'].forEach(code => SAFE_CODES.add(code))
;['CALL_STATE_NOT_CONFIGURED', 'DEVICE_BUSY', 'INVALID_EVENT', 'REQUEST_CONFLICT', 'UNSUPPORTED_ROUTE', 'VOIP_AUTH_REQUIRED'].forEach(code => SAFE_CODES.add(code))
function statusFor(code) {
  if (['AUTH_REQUIRED'].includes(code)) return 401
  if (['FORBIDDEN', 'BINDING_CHANGED', 'CONSENT_REQUIRED'].includes(code)) return 403
  if (code === 'NOT_FOUND') return 404
  if (code === 'PAYLOAD_TOO_LARGE') return 413
  if (code === 'REQUEST_TIMEOUT') return 408
  if (['CALL_ACTIVE', 'CALL_BUSY', 'DEVICE_BUSY', 'REQUEST_CONFLICT', 'ROOM_CONFLICT'].includes(code)) return 409
  if (/CONFIGURED|UNAVAILABLE|TIMEOUT/.test(code) || code === 'CONFIG_REQUIRED') return 503
  return 400
}
function readBody(req, raw = false) {
  return new Promise((resolve, reject) => {
    let bytes = 0, chunks = [], settled = false
    const finish = (err, body) => {
      if (settled) return; settled = true; clearTimeout(timer); chunks = []
      err ? reject(err) : resolve(body)
    }
    const timer = setTimeout(() => finish({ code: 'REQUEST_TIMEOUT', message: '请求内容未完整送达' }), 10000)
    req.on('data', chunk => {
      bytes += chunk.length
      if (bytes > LIMIT) { finish({ code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大' }); return }
      if (!settled) chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      try { const bytes = Buffer.concat(chunks); finish(null, raw ? bytes : JSON.parse(bytes.toString('utf8'))) }
      catch (_) { finish({ code: 'INVALID_JSON', message: '请发送有效的 JSON 业务请求' }) }
    })
    req.on('aborted', () => finish({ code: 'REQUEST_TIMEOUT', message: '请求已中断' }))
    req.on('error', () => finish({ code: 'REQUEST_TIMEOUT', message: '请求已中断' }))
  })
}
function createServer({ config = readConfig(), runtime = createRuntime(config), log = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID()
    let status = 500, code = 'INTERNAL_ERROR'
    const send = (s, body) => {
      status = s
      res.writeHead(s, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId })
      res.end(JSON.stringify({ ...body, requestId, serverTime: Date.now() }))
    }
    try {
      if (req.method === 'GET' && req.url === '/healthz') { code = 'OK'; send(200, { ok: true, data: { service: 'ailab-mini-device', processAlive: true, businessVerified: false } }); return }
      if (req.url !== '/api/gateway') { code = 'NOT_FOUND'; send(404, { ok: false, error: { code, message: '没有这个业务接口' } }); return }
      if (req.method !== 'POST') { code = 'METHOD_NOT_ALLOWED'; send(405, { ok: false, error: { code, message: '业务接口仅支持 POST' } }); return }
      const user = gatewayIdentity(req.headers, config)
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('INVALID_JSON', '业务请求须使用 application/json')
      const body = await readBody(req)
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.action !== 'string' || body.action.length > 64 || body.payload != null && (typeof body.payload !== 'object' || Array.isArray(body.payload))) fail('INVALID_ARGUMENT', '业务操作或参数格式不正确')
      // Identity/roles in body are ignored. Device scope is reauthorized by core.
      const data = await runtime.dispatch(body.action, body.payload || {}, user)
      code = 'OK'; send(200, { ok: true, data })
    } catch (e) {
      const safe = SAFE_CODES.has(e && e.code)
      code = safe ? e.code : 'INTERNAL_ERROR'
      send(safe ? statusFor(code) : 500, { ok: false, error: { code, message: safe ? e.message : '设备后台暂不可用，请稍后重试' } })
    } finally {
      // Do not log request/headers/body/OpenID/coordinates/SQL/upstream messages.
      log({ requestId, status, code })
      if (!req.complete) req.resume()
    }
  })
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000
  server.maxHeadersCount = 48
  return server
}
module.exports = { createServer, readBody, statusFor }
if (require.main === module) {
  try {
    const config = readConfig()
    const testRole = config.serviceRole === 'test-location-ingress'
    const ingress = require(testRole ? './test-location-ingress' : './location-ingress')
    const runtime = testRole ? ingress.createTestIngressRuntime(config) : config.serviceRole === 'location-ingress' ? ingress.createIngressRuntime(config) : createRuntime(config)
    const options = { config, runtime, log: item => console.info(JSON.stringify(item)) }
    const server = testRole ? ingress.createTestIngressServer(options) : config.serviceRole === 'location-ingress' ? ingress.createIngressServer(options) : createServer(options)
    let sweeping = false
    const sweepTimer = setInterval(async () => {
      if (sweeping) return
      sweeping = true
      try { await runtime.sweep() } catch (_) { console.error('定位过期数据清理未完成，请检查私有数据库') } finally { sweeping = false }
    }, 10000)
    sweepTimer.unref()
    server.on('error', () => { console.error('设备后台监听失败，请核对本地端口或云托管配置'); process.exitCode = 1 })
    server.listen(config.port, config.host, () => console.info('AILab 设备后台已启动；不代表设备、定位或音视频已接通'))
    const stop = () => {
      clearInterval(sweepTimer)
      const timer = setTimeout(() => process.exit(1), 10000); timer.unref()
      server.close(() => { runtime.close().finally(() => { clearTimeout(timer); process.exit(0) }) })
      server.closeIdleConnections()
    }
    process.once('SIGTERM', stop); process.once('SIGINT', stop)
  } catch (_) { console.error('设备后台启动配置不完整；未连接模拟数据库'); process.exitCode = 1 }
}
