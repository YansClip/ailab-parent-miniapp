const http = require('node:http')
const crypto = require('node:crypto')
const { credentials, verify, PATH } = require('./location-ingest-auth')
const { createRepository } = require('./repository')
const { createLocationStore } = require('./location-store')
const { policy, fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
function createIngressRuntime(config, dependencies = {}) {
  policy(config)
  const keys = credentials(config.locationRelayKeys)
  if (!keys.size) fail('AUTH_NOT_CONFIGURED', '请先配置定位转发签名密钥及设备白名单')
  if (!dependencies.repo && config.storageDriver !== 'mysql') fail('STORAGE_NOT_CONFIGURED', '定位接收须配置私有持久化数据库')
  const repo = dependencies.repo || createRepository(config)
  const store = createLocationStore({ repo, config, now: dependencies.now })
  return { keys, ingest: store.ingest, sweep: store.sweep, close: () => repo.close() }
}
function createIngressServer({ config, runtime = createIngressRuntime(config), log = () => {}, now = Date.now, path = PATH, serviceName = 'ailab-location-ingress' }) {
  // Separate service, not an extra public route on the private WeChat gateway.
  const { readBody, statusFor } = require('./server')
  const codes = new Set(['AUTH_REQUIRED', 'AUTH_NOT_CONFIGURED', 'FORBIDDEN', 'BINDING_CHANGED', 'INVALID_LOCATION', 'REQUEST_CONFLICT', 'CONFIG_REQUIRED', 'PROVIDER_NOT_CONFIGURED', 'STORAGE_NOT_CONFIGURED', 'STORAGE_UNAVAILABLE', 'PAYLOAD_TOO_LARGE', 'INVALID_JSON', 'INVALID_ARGUMENT', 'REQUEST_TIMEOUT'])
  const server = http.createServer(async (req, res) => {
    const requestId = crypto.randomUUID()
    let status = 500, code = 'INTERNAL_ERROR'
    const send = (s, body) => { status = s; res.writeHead(s, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify({ ...body, requestId, serverTime: now() })) }
    try {
      if (req.url === '/healthz' && req.method === 'GET') { code = 'OK'; send(200, { ok: true, data: { service: serviceName, processAlive: true, businessVerified: false } }); return }
      if (req.url !== path) { code = 'NOT_FOUND'; send(404, { ok: false, error: { code, message: '没有这个定位接口' } }); return }
      if (req.method !== 'POST') { code = 'METHOD_NOT_ALLOWED'; send(405, { ok: false, error: { code, message: '定位上报仅支持 POST' } }); return }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('INVALID_JSON', '定位上报须为 JSON')
      const bytes = await readBody(req, true)
      const actor = verify(req.headers, bytes, runtime.keys, now(), path)
      let body
      try { body = JSON.parse(bytes.toString('utf8')) } catch (_) { fail('INVALID_JSON', '定位上报 JSON 无效') }
      const data = await runtime.ingest(body, actor)
      code = 'OK'; send(200, { ok: true, data })
    } catch (e) {
      code = codes.has(e && e.code) ? e.code : 'INTERNAL_ERROR'
      send(code === 'INTERNAL_ERROR' ? 500 : statusFor(code), { ok: false, error: { code, message: code === 'INTERNAL_ERROR' ? '定位接收暂不可用' : e.message } })
    } finally { log({ requestId, status, code }); if (!req.complete) req.resume() }
  })
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 32
  return server
}
module.exports = { createIngressRuntime, createIngressServer }
