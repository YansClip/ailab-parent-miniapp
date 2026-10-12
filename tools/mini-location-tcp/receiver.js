'use strict'

const net = require('node:net')
const tls = require('node:tls')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { parseFrame, FrameDecoder } = require('./protocol')

function positive(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(name + ' 必须是正整数')
  return value
}

function createReceiver(options = {}) {
  const config = {
    port: 18765, framing: 'line', ack: 'none', coordinateSystem: 'UNKNOWN',
    idleGapMs: 1000, partialTimeoutMs: 15000, socketTimeoutMs: 90000,
    authTimeoutMs: 10000, retentionMs: 60000, maxConnections: 4,
    maxFrameBytes: 512, maxFramesPerSecond: 20, maxBytesPerSecond: 16384,
    maxConnectionsPerMinute: 60, token: '', tls: null,
    now: Date.now, ...options
  }
  // This tool deliberately cannot listen on 0.0.0.0. A separately approved TCP
  // tunnel can forward to this loopback port; it must never forward status APIs.
  if (options.host && options.host !== '127.0.0.1') throw new Error('本工具仅监听本机 127.0.0.1')
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('端口无效')
  if (!['line', 'idle-probe', 'fixed17'].includes(config.framing)) throw new Error('framing 必须为 line、fixed17 或 idle-probe')
  if (!['none', 'ok'].includes(config.ack)) throw new Error('ack 必须为 none 或 ok')
  if (!['UNKNOWN', 'WGS84', 'GCJ02'].includes(config.coordinateSystem)) throw new Error('坐标系无效')
  if (config.framing === 'idle-probe' && config.ack !== 'none') throw new Error('探测模式禁止回成功包')
  if (config.token && !/^[A-Za-z0-9._~-]{24,128}$/.test(config.token)) throw new Error('测试口令须为 24–128 位安全 ASCII 字符')
  for (const key of ['idleGapMs', 'partialTimeoutMs', 'socketTimeoutMs', 'authTimeoutMs',
    'retentionMs', 'maxConnections', 'maxFrameBytes', 'maxFramesPerSecond',
    'maxBytesPerSecond', 'maxConnectionsPerMinute']) positive(config[key], key)

  const events = new EventEmitter()
  const peers = new Map()
  const sockets = new Set()
  const stats = { connections: 0, bytes: 0, parsed: 0, provisional: 0, rejected: 0, registration: 0, heartbeat: 0 }
  let nextId = 1
  let sweepTimer
  let closing = false
  let starting = false
  let startWork
  let stopWork
  let connectionWindowAt = config.now()
  let connectionWindowCount = 0

  const notify = (type, detail = {}) => events.emit('event', { type, at: config.now(), ...detail })
  function expire(peer) {
    // This TTL is only for temporary lab-display retention, NOT fix validity.
    if (peer.latest && config.now() - peer.latest.receivedAt >= config.retentionMs) {
      peer.latest = null
      notify('expired', { connectionId: peer.id })
    }
  }

  function onConnection(socket) {
    if (closing || socket.destroyed) return socket.destroy()
    if (peers.size >= config.maxConnections) {
      stats.rejected++
      notify('rejected', { code: 'CONNECTION_LIMIT' })
      return socket.destroy()
    }
    const peer = {
      id: 'C' + nextId++, socket, authenticated: !config.token,
      latest: null, windowAt: config.now(), frameCount: 0, byteCount: 0
    }
    let gapTimer
    let partialTimer
    let authTimer
    let disconnected = false
    peers.set(peer.id, peer)
    stats.connections++
    notify('connected', { connectionId: peer.id, authenticated: Boolean(config.token) && peer.authenticated })
    socket.setNoDelay(true)
    socket.setTimeout(config.socketTimeoutMs)

    function clearTimers() {
      clearTimeout(gapTimer)
      clearTimeout(partialTimer)
      clearTimeout(authTimer)
    }
    function reject(code, close = false) {
      stats.rejected++
      notify('rejected', { connectionId: peer.id, code })
      if (close) socket.destroy()
    }
    function resetWindow() {
      if (config.now() - peer.windowAt >= 1000) {
        peer.windowAt = config.now()
        peer.frameCount = 0
        peer.byteCount = 0
      }
    }
    const decoder = new FrameDecoder({
      mode: config.framing, maxFrameBytes: config.maxFrameBytes, authLine: Boolean(config.token),
      onError: code => reject(code, true),
      onFrame(frame, boundary) {
        if (socket.destroyed || disconnected) return
        clearTimeout(partialTimer)
        partialTimer = null
        resetWindow()
        if (++peer.frameCount > config.maxFramesPerSecond) return reject('RATE_LIMIT', true)
        if (!peer.authenticated) {
          // Optional lab handshake, not an assertion that vendor firmware already
          // implements it. Credentials are never logged, stored, or echoed.
          const prefix = Buffer.from('AUTH ')
          const clean = frame.length && frame[frame.length - 1] === 13 ? frame.subarray(0, -1) : frame
          const expected = Buffer.from(config.token)
          const actual = clean.subarray(prefix.length)
          const ok = boundary === 'newline' && clean.subarray(0, prefix.length).equals(prefix) &&
            actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
          if (!ok) return reject('AUTH_FAILED', true)
          peer.authenticated = true
          clearTimeout(authTimer)
          notify('authenticated', { connectionId: peer.id })
          // No unsolicited ACK: firmware reply format is not yet agreed.
          return
        }
        // A separate, local-only diagnostic channel. No payload is printed by
        // the CLI; the monitor only retains it during an explicit timed reveal.
        events.emit('diagnostic', { type: 'frame', at: config.now(), connectionId: peer.id,
          boundary, buffer: boundary === 'newline' ? Buffer.concat([frame, Buffer.from('\n')]) : Buffer.from(frame) })
        const parsed = parseFrame(frame)
        if (parsed.kind === 'empty') return
        if (parsed.kind === 'invalid') return reject(parsed.code, config.framing === 'fixed17')
        if (parsed.kind !== 'location') {
          stats[parsed.kind]++
          notify(parsed.kind, { connectionId: peer.id })
          return
        }
        const provisional = config.framing === 'idle-probe'
        const record = {
          connectionId: peer.id, deviceId: null, identityVerified: false,
          authentication: config.token ? 'lab-shared-token' : 'none',
          longitude: parsed.longitude, latitude: parsed.latitude,
          coordinateSystem: config.coordinateSystem,
          measuredAt: null, receivedAt: config.now(), accuracyM: null, source: null,
          framing: provisional ? 'provisional' : config.framing === 'fixed17' ? 'fixed' : 'delimited', boundary,
          displayable: false, productionReady: false
        }
        peer.latest = record
        stats[provisional ? 'provisional' : 'parsed']++
        notify(provisional ? 'candidate' : 'location', { connectionId: peer.id, record: { ...record } })
        // OK acknowledges format reception only; it never means a valid fix,
        // backend persistence, child binding, or success in the Mini Program.
        if (!provisional && config.ack === 'ok' && !socket.destroyed) {
          if (socket.writableLength > 4096) return reject('SLOW_READER', true)
          socket.write('OK\r\n')
        }
      }
    })
    if (config.token) authTimer = setTimeout(() => reject('AUTH_TIMEOUT', true), config.authTimeoutMs)
    socket.on('data', chunk => {
      resetWindow()
      stats.bytes += chunk.length
      peer.byteCount += chunk.length
      if (peer.byteCount > config.maxBytesPerSecond) return reject('BYTE_RATE_LIMIT', true)
      // Never expose a credential handshake, including its fragmented pieces.
      if (peer.authenticated) events.emit('diagnostic', { type: 'bytes', at: config.now(),
        connectionId: peer.id, buffer: Buffer.from(chunk) })
      decoder.push(chunk)
      clearTimeout(gapTimer)
      if (!decoder.pendingBytes || socket.destroyed) return
      if (!partialTimer) partialTimer = setTimeout(() => reject('INCOMPLETE_FRAME', true), config.partialTimeoutMs)
      gapTimer = setTimeout(() => {
        if (socket.destroyed) return
        if (config.framing === 'idle-probe') decoder.flushProbe()
        else notify(config.framing === 'fixed17' ? 'awaiting-frame' : 'awaiting-newline', { connectionId: peer.id, bytes: decoder.pendingBytes })
      }, config.idleGapMs)
    })
    socket.on('timeout', () => reject('SOCKET_IDLE', true))
    socket.on('error', () => notify('socket-error', { connectionId: peer.id, code: 'CONNECTION_ERROR' }))
    socket.on('end', () => {
      // EOF is not the agreed delimiter. Report, but do not accept, its tail.
      if (decoder.pendingBytes) reject('INCOMPLETE_FRAME')
    })
    socket.on('close', () => {
      disconnected = true
      clearTimers()
      decoder.clear()
      peer.latest = null
      peers.delete(peer.id)
      notify('disconnected', { connectionId: peer.id })
    })
  }

  const server = config.tls
    ? tls.createServer({ ...config.tls, minVersion: 'TLSv1.2', handshakeTimeout: config.authTimeoutMs })
    : net.createServer()
  // Track raw sockets too: unfinished TLS handshakes must not escape limits or
  // prevent a clean shutdown. No client IP/port is retained in application state.
  server.on('connection', socket => {
    if (config.now() - connectionWindowAt >= 60000) {
      connectionWindowAt = config.now()
      connectionWindowCount = 0
    }
    if (++connectionWindowCount > config.maxConnectionsPerMinute || sockets.size >= config.maxConnections) {
      stats.rejected++
      notify('rejected', { code: 'CONNECTION_LIMIT' })
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on(config.tls ? 'secureConnection' : 'connection', onConnection)
  server.on('tlsClientError', () => notify('rejected', { code: 'TLS_HANDSHAKE_FAILED' }))
  server.on('error', () => notify('server-error', { code: 'SERVER_ERROR' }))

  return {
    events,
    async start() {
      if (server.listening || starting || closing) throw new Error('接收器已经启动或正在切换，请稍后重试')
      starting = true
      try {
        startWork = new Promise((resolve, reject) => {
          const onError = err => { server.off('listening', onListen); reject(err) }
          const onListen = () => { server.off('error', onError); resolve() }
          server.once('error', onError)
          server.once('listening', onListen)
          server.listen(config.port, '127.0.0.1')
        })
        await startWork
      } finally { starting = false }
      sweepTimer = setInterval(() => peers.forEach(expire), Math.min(config.retentionMs, 1000))
      sweepTimer.unref()
      return { host: '127.0.0.1', port: server.address().port, tls: Boolean(config.tls) }
    },
    snapshot() {
      peers.forEach(expire)
      return {
        running: server.listening && !closing, starting, stopping: closing,
        stats: { ...stats }, connections: [...peers.values()].map(peer => ({
          id: peer.id, authenticated: Boolean(config.token) && peer.authenticated,
          latest: peer.latest ? { ...peer.latest } : null
        }))
      }
    },
    async stop() {
      if (stopWork) return stopWork
      closing = true
      stopWork = (async () => {
        if (starting && startWork) await startWork.catch(() => {})
        clearInterval(sweepTimer)
        for (const peer of peers.values()) peer.socket.destroy()
        for (const socket of sockets) socket.destroy()
        await new Promise(resolve => server.listening ? server.close(resolve) : resolve())
        peers.clear()
      })()
      try { await stopWork } finally { closing = false; stopWork = null }
    }
  }
}

module.exports = { createReceiver }
