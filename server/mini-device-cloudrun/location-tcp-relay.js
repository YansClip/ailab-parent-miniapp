const net = require('node:net')
const tls = require('node:tls')
const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { FrameDecoder, parseFrame } = require('../../tools/mini-location-tcp/protocol')
const { signHeaders, PATH } = require('./location-ingest-auth')
const { fail, id } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
function readRelayConfig(env = process.env) {
  let devices
  try { devices = JSON.parse(env.LOCATION_TCP_DEVICES_JSON || '[]') } catch (_) { fail('CONFIG_REQUIRED', 'TCP 设备凭证配置不是有效 JSON') }
  const config = { host: env.LOCATION_TCP_HOST || '127.0.0.1', port: Number(env.LOCATION_TCP_PORT || 18767), devices,
    ingressUrl: env.LOCATION_INGRESS_URL || '', keyId: env.LOCATION_RELAY_KEY_ID || '', secret: env.LOCATION_RELAY_SECRET || '',
    tls: env.LOCATION_TLS_CERT_FILE && env.LOCATION_TLS_KEY_FILE ? { cert: fs.readFileSync(env.LOCATION_TLS_CERT_FILE), key: fs.readFileSync(env.LOCATION_TLS_KEY_FILE) } : null }
  return config
}
function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || typeof config.host !== 'string') fail('CONFIG_REQUIRED', 'TCP 监听配置无效')
  if (config.host !== '127.0.0.1' && (!config.tls || !config.tls.cert || !config.tls.key)) fail('CONFIG_REQUIRED', '非本机 TCP 接入必须配置 TLS，禁止明文上传真实位置')
  if (!Array.isArray(config.devices) || !config.devices.length || config.devices.length > 100) fail('CONFIG_REQUIRED', '请配置 TCP 设备凭证')
  const devices = new Map()
  for (const row of config.devices) {
    if (!row) fail('CONFIG_REQUIRED', '设备凭证配置无效')
    id(row.deviceId)
    if (devices.has(row.deviceId) || !/^[A-Za-z0-9_-]{43,128}$/.test(row.token || '') || !Number.isSafeInteger(row.bindingVersion) || row.bindingVersion < 1 || !['fixed17', 'jsonl'].includes(row.framing) || !['WGS84', 'GCJ02'].includes(row.coordinateSystem)) fail('CONFIG_REQUIRED', '设备须有独立凭证、绑定版本、报文格式和坐标系')
    devices.set(row.deviceId, { ...row })
  }
  return devices
}
function createForwarder(config) {
  let url
  try { url = new URL(config.ingressUrl) } catch (_) { fail('CONFIG_REQUIRED', '请配置独立定位接收 URL') }
  if (url.pathname !== PATH || url.search || url.hash || url.username || url.password || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && url.hostname !== '127.0.0.1') fail('CONFIG_REQUIRED', '定位转发只能走 HTTPS；HTTP 仅允许本机合成测试')
  id(config.keyId)
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.secret || '')) fail('CONFIG_REQUIRED', '请配置独立定位转发签名密钥')
  return report => new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(report))
    const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers: { ...signHeaders(config.keyId, config.secret, bytes), 'content-length': bytes.length } }, res => {
      let size = 0, chunks = []
      res.on('data', chunk => { size += chunk.length; if (size > 16384) res.destroy(); else chunks.push(chunk) })
      res.on('error', () => reject({ code: 'INGRESS_UNAVAILABLE' }))
      res.on('end', () => {
        let body
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (_) { return reject({ code: 'INGRESS_RESPONSE_INVALID' }) }
        if (res.statusCode !== 200 || !body || body.ok !== true || !body.data || typeof body.data.accepted !== 'boolean') return reject({ code: 'INGRESS_REJECTED' })
        resolve(body.data)
      })
    })
    req.setTimeout(5000, () => req.destroy())
    req.on('error', () => reject({ code: 'INGRESS_UNAVAILABLE' }))
    req.end(bytes)
  })
}
function createTcpRelay({ config, forward = createForwarder(config), now = Date.now, log = () => {} }) {
  const devices = validateConfig(config)
  const peers = new Set(), owners = new Map(), pending = new Map(), queues = new Map()
  let stopping = false, connectionAt = now(), connectionCount = 0, lastObservation = 0
  function observe() { lastObservation = Math.max(now(), lastObservation + 1); return lastObservation }
  function submit(device, fields) {
    const count = pending.get(device.deviceId) || 0
    if (count >= 4) { log({ code: 'QUEUE_LIMIT' }); return false }
    const report = { version: 1, eventId: crypto.randomUUID(), deviceId: device.deviceId, bindingVersion: device.bindingVersion, observedAt: observe(), ...fields }
    pending.set(device.deviceId, count + 1)
    const job = (queues.get(device.deviceId) || Promise.resolve()).then(() => forward(report)).then(result => log({ code: result.accepted ? result.usable ? 'LOCATION_USABLE' : 'LOCATION_RECEIVED_NOT_USABLE' : 'LOCATION_IGNORED' })).catch(() => log({ code: 'LOCATION_FORWARD_FAILED' })).finally(() => { pending.set(device.deviceId, pending.get(device.deviceId) - 1); if (queues.get(device.deviceId) === job) { queues.delete(device.deviceId); pending.delete(device.deviceId) } })
    queues.set(device.deviceId, job)
    return true
  }
  function connected(socket) {
    if (stopping || socket.destroyed) return socket.destroy()
    let device = null, decoder, partialTimer, windowAt = now(), frameCount = 0, byteCount = 0
    const authTimer = setTimeout(() => socket.destroy(), 10000)
    const reject = code => { log({ code }); socket.destroy() }
    // Authentication is always a bounded CRLF/LF line, irrespective of the
    // following device framing. IMEI registration is NOT authentication.
    decoder = new FrameDecoder({ mode: 'line', maxFrameBytes: 512,
      onError: reject,
      onFrame(frame) {
        clearTimeout(partialTimer); partialTimer = null
        if (++frameCount > 20) return reject('FRAME_RATE_LIMIT')
        if (!device) {
          const match = /^AUTH ([A-Za-z0-9_-]{1,128}) ([A-Za-z0-9_-]{43,128})\r?$/.exec(frame.toString('utf8'))
          const expected = match && devices.get(match[1])
          if (!expected || match[2].length !== expected.token.length || !crypto.timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected.token))) return reject('DEVICE_AUTH_FAILED')
          device = expected; clearTimeout(authTimer)
          const previous = owners.get(device.deviceId)
          owners.set(device.deviceId, socket)
          if (previous && previous !== socket) previous.destroy()
          log({ code: 'DEVICE_AUTHENTICATED' })
          return
        }
        if (owners.get(device.deviceId) !== socket) return reject('SESSION_REPLACED')
        if (device.framing === 'fixed17') {
          const parsed = parseFrame(frame)
          if (parsed.kind === 'registration' || parsed.kind === 'empty') return
          if (parsed.kind !== 'location') return reject('FIXED_FORMAT')
          if (!submit(device, { status: 'valid', coordinateSystem: device.coordinateSystem, measuredAt: null, longitude: parsed.longitude, latitude: parsed.latitude, accuracyM: null, battery: null })) reject('QUEUE_LIMIT')
        } else {
          let value
          try { value = JSON.parse(frame.toString('utf8')) } catch (_) { return reject('INVALID_JSON') }
          if (!value || Array.isArray(value) || Object.keys(value).some(k => !['version', 'status', 'measuredAt', 'longitude', 'latitude', 'accuracyM', 'battery'].includes(k)) || value.version !== 1 || !['valid', 'no-fix'].includes(value.status) || value.status === 'valid' && (!Number.isSafeInteger(value.measuredAt) || value.measuredAt <= 0)) return reject('INVALID_LOCATION')
          if (!submit(device, { ...value, coordinateSystem: device.coordinateSystem })) reject('QUEUE_LIMIT')
        }
      }
    })
    // Feed the auth line bytewise so a coalesced AUTH + fixed17 packet switches
    // decoder before consuming any coordinate bytes; no TCP-packet assumptions.
    socket.on('data', chunk => {
      if (now() - windowAt >= 1000) { windowAt = now(); frameCount = 0; byteCount = 0 }
      byteCount += chunk.length
      if (byteCount > 16384) return reject('BYTE_RATE_LIMIT')
      for (let i = 0; i < chunk.length && !socket.destroyed; i++) {
        decoder.push(chunk.subarray(i, i + 1))
        if (device && device.framing === 'fixed17' && decoder.mode !== 'fixed17') decoder = new FrameDecoder({ mode: 'fixed17', maxFrameBytes: 512, onError: reject, onFrame: decoder.onFrame })
      }
      if (decoder.pendingBytes && !partialTimer) partialTimer = setTimeout(() => reject('INCOMPLETE_FRAME'), 15000)
    })
    socket.setNoDelay(true); socket.setTimeout(90000)
    socket.on('timeout', () => reject('SOCKET_IDLE'))
    socket.on('error', () => log({ code: 'SOCKET_ERROR' }))
    socket.on('close', () => {
      clearTimeout(authTimer); clearTimeout(partialTimer); decoder.clear()
      if (device && owners.get(device.deviceId) === socket) {
        owners.delete(device.deviceId)
        submit(device, { status: 'offline', measuredAt: null, coordinateSystem: device.coordinateSystem })
      }
    })
  }
  const server = config.tls ? tls.createServer({ ...config.tls, minVersion: 'TLSv1.2', handshakeTimeout: 10000 }) : net.createServer()
  server.on('connection', socket => {
    if (now() - connectionAt >= 60000) { connectionAt = now(); connectionCount = 0 }
    if (stopping || ++connectionCount > 60 || peers.size >= 16) return socket.destroy()
    peers.add(socket); socket.once('close', () => peers.delete(socket))
  })
  server.on(config.tls ? 'secureConnection' : 'connection', connected)
  server.on('tlsClientError', () => log({ code: 'TLS_HANDSHAKE_FAILED' }))
  return {
    async start() {
      await new Promise((resolve, reject) => { const failed = e => { server.off('listening', ready); reject(e) }; const ready = () => { server.off('error', failed); resolve() }; server.once('error', failed); server.once('listening', ready); server.listen(config.port, config.host) })
      return server.address()
    },
    async stop() {
      stopping = true
      for (const socket of peers) socket.destroy()
      await new Promise(resolve => server.listening ? server.close(resolve) : resolve())
      await Promise.all([...queues.values()])
    }
  }
}
if (require.main === module) {
  try {
    const relay = createTcpRelay({ config: readRelayConfig(), log: item => console.info(JSON.stringify(item)) })
    relay.start().then(() => console.info('定位 TCP 转发器已启动；不是既有联调台，未启用公网穿透')).catch(() => { console.error('定位 TCP 转发器监听失败'); process.exitCode = 1 })
    const stop = () => { const timer = setTimeout(() => process.exit(1), 10000); timer.unref(); relay.stop().then(() => { clearTimeout(timer); process.exit(0) }) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  } catch (_) { console.error('定位 TCP 转发器配置未完成；未读取或上传真实定位'); process.exitCode = 1 }
}
module.exports = { readRelayConfig, validateConfig, createForwarder, createTcpRelay }
