// Legacy fixed17 receipt diagnostics. Registration is routing, NOT device auth.
const net = require('node:net')
const tls = require('node:tls')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { FrameDecoder, parseFrame } = require('../../tools/mini-location-tcp/protocol')
const { createForwarder } = require('./location-tcp-relay')
const { PATH } = require('./test-location-store')
const { fail, id } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
function readTestRelayConfig(env = process.env) {
  let devices, sourceIps
  try { devices = JSON.parse(env.TEST_LOCATION_TCP_DEVICES_JSON || '[]'); sourceIps = JSON.parse(env.TEST_LOCATION_TCP_SOURCE_IPS_JSON || '[]') }
  catch (_) { fail('CONFIG_REQUIRED', '测试接收配置不是有效 JSON') }
  return { host: env.TEST_LOCATION_TCP_HOST || '127.0.0.1', port: Number(env.TEST_LOCATION_TCP_PORT || 18769), devices, sourceIps,
    expiresAt: Date.parse(env.TEST_LOCATION_EXPIRES_AT || ''), ingressUrl: env.TEST_LOCATION_INGRESS_URL || '',
    keyId: env.TEST_LOCATION_RELAY_KEY_ID || '', secret: env.TEST_LOCATION_RELAY_SECRET || '',
    tls: env.TEST_LOCATION_TLS_CERT_FILE && env.TEST_LOCATION_TLS_KEY_FILE ? { cert: fs.readFileSync(env.TEST_LOCATION_TLS_CERT_FILE), key: fs.readFileSync(env.TEST_LOCATION_TLS_KEY_FILE) } : null }
}
function validate(config, now) {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || !net.isIP(config.host) || !Number.isSafeInteger(config.expiresAt) || config.expiresAt <= now() || config.expiresAt - now() > 86400000) fail('CONFIG_REQUIRED', '请配置监听地址及不超过 24 小时的测试截止时间')
  if (config.host !== '127.0.0.1' && (!config.tls || !config.tls.cert || !config.tls.key || !Array.isArray(config.sourceIps) || !config.sourceIps.length || config.sourceIps.some(ip => !net.isIP(ip)))) fail('CONFIG_REQUIRED', '非本机测试接入须有 TLS 和明确来源 IP；禁止直接公开明文位置入口')
  if (!Array.isArray(config.devices) || !config.devices.length || config.devices.length > 10) fail('CONFIG_REQUIRED', '请配置明确测试设备')
  const ids = new Set(), registrations = new Set()
  for (const row of config.devices) {
    if (!row) fail('CONFIG_REQUIRED', '测试设备配置无效')
    id(row.deviceId)
    if (!Number.isSafeInteger(row.bindingVersion) || row.bindingVersion < 1 || !['imei', 'iccid'].includes(row.registrationField) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(row.registrationValue || '') || !['UNKNOWN', 'WGS84', 'GCJ02'].includes(row.coordinateSystem) || ids.has(row.deviceId) || registrations.has(row.registrationField + ':' + row.registrationValue)) fail('CONFIG_REQUIRED', '设备映射、绑定版本、坐标系配置无效或重复')
    ids.add(row.deviceId); registrations.add(row.registrationField + ':' + row.registrationValue)
  }
}
function createTestTcpRelay({ config, forward = createForwarder(config, PATH), now = Date.now, log = () => {} }) {
  validate(config, now)
  const peers = new Set(), owners = new Map(), queues = new Map(), pending = new Map()
  let stopping = false, connectionAt = now(), connectionCount = 0, lastObservation = 0, expiryTimer
  const active = () => !stopping && now() < config.expiresAt
  function submit(device, status, point = null) {
    if (!active()) return false
    const count = pending.get(device.deviceId) || 0
    if (count >= 4) return false
    lastObservation = Math.max(now(), lastObservation + 1)
    const report = { version: 1, purpose: 'engineer-location-test', eventId: crypto.randomUUID(), deviceId: device.deviceId,
      bindingVersion: device.bindingVersion, observedAt: lastObservation, status, coordinateSystem: device.coordinateSystem,
      longitude: point ? point.longitude : null, latitude: point ? point.latitude : null }
    pending.set(device.deviceId, count + 1)
    const job = (queues.get(device.deviceId) || Promise.resolve()).then(() => {
      if (now() >= config.expiresAt) return { accepted: false }
      return forward(report)
    }).then(result => log({ code: result.accepted ? 'TEST_RECEIPT_ACCEPTED' : 'TEST_RECEIPT_IGNORED' }))
      .catch(() => log({ code: 'TEST_FORWARD_FAILED' })).finally(() => {
        pending.set(device.deviceId, pending.get(device.deviceId) - 1)
        if (queues.get(device.deviceId) === job) { queues.delete(device.deviceId); pending.delete(device.deviceId) }
      })
    queues.set(device.deviceId, job)
    return true
  }
  function connected(socket) {
    if (!active() || socket.destroyed) return socket.destroy()
    let device, partialTimer, windowAt = now(), frames = 0, bytes = 0
    const registrationTimer = setTimeout(() => socket.destroy(), 10000)
    const reject = code => { decoder.failed = true; log({ code }); socket.destroy() }
    const decoder = new FrameDecoder({ mode: 'fixed17', maxFrameBytes: 512, onError: reject, onFrame(frame) {
      if (!active() || socket.destroyed) return reject('TEST_WINDOW_ENDED')
      clearTimeout(partialTimer); partialTimer = null
      if (++frames > 20) return reject('FRAME_RATE_LIMIT')
      const parsed = parseFrame(frame)
      if (!device) {
        if (parsed.kind !== 'registration') return reject('REGISTRATION_REQUIRED')
        const registration = JSON.parse(frame.toString('utf8'))
        const matches = config.devices.filter(d => {
          const value = registration[d.registrationField]
          return (typeof value === 'string' || Number.isSafeInteger(value)) && String(value) === d.registrationValue
        })
        if (matches.length !== 1) return reject('REGISTRATION_NOT_ALLOWED')
        device = matches[0]; clearTimeout(registrationTimer)
        const previous = owners.get(device.deviceId)
        owners.set(device.deviceId, socket)
        if (previous && previous !== socket) previous.destroy()
        log({ code: 'TEST_DEVICE_MAPPED_NOT_AUTHENTICATED' })
        return
      }
      if (owners.get(device.deviceId) !== socket) return reject('SESSION_REPLACED')
      if (parsed.kind !== 'location') return reject('INVALID_COORDINATES')
      if (!submit(device, 'received', parsed)) reject('QUEUE_LIMIT')
    } })
    socket.on('data', chunk => {
      if (!active()) return reject('TEST_WINDOW_ENDED')
      if (now() - windowAt >= 1000) { windowAt = now(); frames = 0; bytes = 0 }
      bytes += chunk.length
      if (bytes > 16384) return reject('BYTE_RATE_LIMIT')
      decoder.push(chunk)
      if (decoder.pendingBytes && !partialTimer) partialTimer = setTimeout(() => reject('INCOMPLETE_FRAME'), 15000)
    })
    socket.setNoDelay(true); socket.setTimeout(90000)
    socket.on('timeout', () => reject('SOCKET_IDLE'))
    socket.on('error', () => log({ code: 'SOCKET_ERROR' }))
    socket.on('close', () => {
      clearTimeout(registrationTimer); clearTimeout(partialTimer); decoder.clear()
      if (device && owners.get(device.deviceId) === socket) { owners.delete(device.deviceId); submit(device, 'offline') }
    })
  }
  const server = config.tls ? tls.createServer({ ...config.tls, minVersion: 'TLSv1.2', handshakeTimeout: 10000 }) : net.createServer()
  server.on('connection', socket => {
    if (now() - connectionAt >= 60000) { connectionAt = now(); connectionCount = 0 }
    const ip = (socket.remoteAddress || '').replace(/^::ffff:/, '')
    if (!active() || ++connectionCount > 60 || peers.size >= 16 || config.host !== '127.0.0.1' && !config.sourceIps.includes(ip)) return socket.destroy()
    peers.add(socket); socket.once('close', () => peers.delete(socket))
  })
  server.on(config.tls ? 'secureConnection' : 'connection', connected)
  server.on('tlsClientError', () => log({ code: 'TLS_HANDSHAKE_FAILED' }))
  return {
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, () => { server.off('error', reject); resolve() }) })
      expiryTimer = setTimeout(() => { for (const socket of peers) socket.destroy(); server.close() }, Math.max(1, config.expiresAt - now()))
      expiryTimer.unref()
      return server.address()
    },
    async stop() {
      stopping = true; clearTimeout(expiryTimer)
      for (const socket of peers) socket.destroy()
      await new Promise(resolve => server.listening ? server.close(resolve) : resolve())
      await Promise.all([...queues.values()])
    }
  }
}
if (require.main === module) {
  try {
    const relay = createTestTcpRelay({ config: readTestRelayConfig(), log: item => console.info(JSON.stringify(item)) })
    relay.start().then(() => console.info('硬件定位测试接收器已启动；未创建公网通道，不代表云端已部署')).catch(() => { console.error('测试接收器监听失败'); process.exitCode = 1 })
    const stop = () => { const timer = setTimeout(() => process.exit(1), 10000); timer.unref(); relay.stop().then(() => { clearTimeout(timer); process.exit(0) }) }
    process.once('SIGINT', stop); process.once('SIGTERM', stop)
  } catch (_) { console.error('测试接收器配置未完成，未开始接收位置'); process.exitCode = 1 }
}
module.exports = { readTestRelayConfig, validate, createTestTcpRelay }
