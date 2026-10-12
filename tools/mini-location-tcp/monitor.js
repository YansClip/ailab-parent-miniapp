'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { createMediaMonitor } = require('./media-monitor')
const { createTunnelController } = require('./tunnel-controller')
const { createLabBridge } = require('./lab-bridge')

const errorLabels = {
  INCOMPLETE_FRAME: '报文未收完整（JSON 未闭合、定位字节不足或缺少约定结束符），已断开', INVALID_FORMAT: '不是约定的“经度_纬度”格式',
  FIXED_FORMAT: '不符合 17 字节格式 DDD.dddd_DD.ddddd，已断开以避免错位',
  OUT_OF_RANGE: '经纬度超出范围', ZERO_FIX: '收到 0_0，不作为定位', UNSUPPORTED_JSON: '收到尚未支持的 JSON 格式',
  AUTH_FAILED: '测试口令不匹配', AUTH_TIMEOUT: '认证等待超时', FRAME_TOO_LARGE: '报文超过长度限制',
  RATE_LIMIT: '发送过快，已限流', BYTE_RATE_LIMIT: '短时间数据量过大', SOCKET_IDLE: '长时间无数据，连接已清理',
  CONNECTION_LIMIT: '连接次数或并发连接超过限制', TLS_HANDSHAKE_FAILED: 'TLS 握手失败', SLOW_READER: '客户端未及时接收回包'
}
const labels = {
  connected: '新的 TCP 连接（尚未验证设备身份）', disconnected: '连接已断开', authenticated: '测试口令通过',
  location: '完整坐标格式通过；不代表正式定位有效', candidate: '疑似坐标；分包尚未确认',
  registration: '收到注册信息；不是定位数据', heartbeat: '收到 PING 心跳',
  'awaiting-newline': '有数据，但仍在等待换行符', expired: '临时坐标展示已过期',
  'awaiting-frame': '等待完整注册 JSON 或收齐 17 字节坐标（无需换行）',
  'socket-error': '连接异常', 'server-error': '接收服务异常'
}

function readTunnelStatus(now, receiverPid) {
  try {
    const file = path.join(__dirname, 'private', 'current-tunnel.json')
    if (fs.statSync(file).size > 8192) return { active: false, reason: '状态文件异常' }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    const expiresAt = Date.parse(value.expiresAt)
    const validEndpoint = value.endpoint && /^[a-z0-9.-]+\.(?:pinggy|pinggy-free)\.link$/.test(value.endpoint.host) &&
      Number.isInteger(value.endpoint.port) && value.endpoint.port > 0 && value.endpoint.port <= 65535
    const belongsHere = value.receiverPid === receiverPid
    let running = false
    if (Number.isSafeInteger(value.pid) && value.pid > 1) {
      try { process.kill(value.pid, 0); running = true } catch (_) {}
    }
    const active = Boolean(validEndpoint && belongsHere && running && value.state === 'ready-unverified' && expiresAt > now)
    return {
      active, endpoint: active ? value.endpoint : null, expiresAt: active ? expiresAt : null,
      reason: active ? '地址已分配，硬件上传仍需核对' : (value.state === 'closed' || expiresAt <= now) ? '上一轮入口已关闭或到期' : '没有与当前接收程序关联的公网入口',
      syntheticOnly: true
    }
  } catch (_) { return { active: false, reason: '尚未启动公网测试入口', syntheticOnly: true } }
}

function createMonitor(receiver, options = {}) {
  const config = { port: 18866, tcpPort: 18765, framing: 'line', ack: 'none', coordinateSystem: 'UNKNOWN',
    now: Date.now, getTunnel: () => readTunnelStatus(Date.now(), process.pid), ...options }
  const token = crypto.randomBytes(32).toString('hex')
  const media = createMediaMonitor(config.now)
  const lab = createLabBridge(receiver, media, { now: config.now })
  const tunnelControl = options.tunnelControl || (config.enableTunnelControls ? createTunnelController({ monitorPort: config.port }) : null)
  let rows = []
  const raw = new Map()
  let sequence = 0
  let revealUntil = 0
  let lastReceivedAt = null
  let testing = false
  let stopped = false
  let receiverControlBusy = false
  const testSockets = new Set()
  const clients = new Set()
  let pruneTimer
  function prune() {
    const now = config.now()
    rows = rows.filter(row => now - row.at < 300000).slice(-100)
    for (const [id, value] of raw) if (now - value.at >= 60000 || now >= revealUntil) raw.delete(id)
    if (now >= revealUntil) revealUntil = 0
  }
  function add(row) {
    const event = { id: ++sequence, at: config.now(), ...row }
    rows.push(event)
    prune()
    return event
  }
  function onEvent(event) {
    add({ at: event.at, connectionId: event.connectionId || '服务', type: event.type,
      level: event.type === 'rejected' || event.type.endsWith('error') ? 'error' :
        ['awaiting-newline', 'awaiting-frame', 'candidate'].includes(event.type) ? 'warning' : 'info',
      summary: event.type === 'rejected' ? (errorLabels[event.code] || '接收异常') : (labels[event.type] || event.type),
      code: event.code || null, bytes: event.bytes })
    // Never retain coordinate-bearing event.record in the event list.
  }
  function onDiagnostic(event) {
    const buffer = event.buffer
    const lf = buffer.reduce((n, byte) => n + (byte === 10 ? 1 : 0), 0)
    const cr = buffer.reduce((n, byte) => n + (byte === 13 ? 1 : 0), 0)
    const text = buffer.toString('utf8')
    const shape = /^\s*\{/.test(text) ? 'JSON 样式片段' : /^\s*[+-]?\d/.test(text) ? '数字样式片段' : '其他文本或二进制片段'
    if (event.type === 'bytes') lastReceivedAt = event.at
    const row = add({ at: event.at, connectionId: event.connectionId, type: event.type, level: 'info',
      summary: event.type === 'bytes' ? `收到 ${buffer.length} 字节 · ${shape}` : `组成 ${buffer.length} 字节报文 · ${{ newline: '以 LF 结束', fixed17: '固定 17 字节坐标', 'json-object': '完整注册 JSON，已单独分包' }[event.boundary] || '空闲探测，不可靠'}`,
      bytes: buffer.length, lf, cr, literalCRLF: text.includes('\\r\\n'), boundary: event.boundary || 'TCP 传输片段（不等于完整报文）' })
    if (config.now() < revealUntil) {
      // AUTH handshakes are never captured; credentials may also be present in
      // user-provided payloads, hence the explicit local-only 60 second consent.
      if (/\bAUTH\s/i.test(text)) return
      const shown = buffer.subarray(0, 512)
      raw.set(row.id, { at: event.at, text: shown.toString('utf8'), hex: shown.toString('hex').match(/.{1,2}/g)?.join(' ').toUpperCase() || '', truncated: buffer.length > 512 })
      while (raw.size > 8) raw.delete(raw.keys().next().value)
    }
  }
  receiver.events.on('event', onEvent)
  receiver.events.on('diagnostic', onDiagnostic)

  function snapshot() {
    prune()
    const snapshot = receiver.snapshot()
    const reveal = config.now() < revealUntil
    return {
      now: config.now(), revealUntil, lastReceivedAt, media: media.snapshot(), lab: lab.snapshot(),
      receiver: { host: '127.0.0.1', port: config.tcpPort, framing: config.framing, ack: config.ack, coordinateSystem: config.coordinateSystem,
        running: snapshot.running, changing: receiverControlBusy },
      stats: snapshot.stats,
      connections: snapshot.connections.map(peer => ({ id: peer.id, authenticated: peer.authenticated,
        hasCoordinate: Boolean(peer.latest), receivedAt: peer.latest?.receivedAt || null,
        framing: peer.latest?.framing || null,
        coordinate: reveal && peer.latest ? { longitude: peer.latest.longitude, latitude: peer.latest.latitude } : null })),
      tunnel: (() => {
        const own = tunnelControl?.snapshot()
        const external = config.getTunnel()
        return { ...(own && (own.state !== 'closed' || !external.active) ? own : external), controllable: Boolean(tunnelControl) && !config.secured && config.tcpPort === 18765 }
      })(),
      events: rows.map(row => ({ ...row, raw: reveal ? raw.get(row.id) || null : null }))
    }
  }

  async function selfTest(scene) {
    if (!receiver.snapshot().running || receiverControlBusy) throw new Error('请先开启接收')
    if (config.secured) throw new Error('认证或 TLS 模式请使用专用发送脚本自测')
    if (testing) throw new Error('已有本机自测进行中')
    const fixed = config.framing === 'fixed17'
    const samples = fixed
      ? { normal: '120.0001_30.00010', missing: '120.0001_30.', registration: '{"imei":"TEST-NOT-REAL","csq":20}120.0001_30.00010' }
      : { normal: '120.0001_30.0001\r\n', missing: '120.0001_30.0001', registration: '{"imei":"TEST-NOT-REAL","csq":20}\r\n' }
    if (!Object.hasOwn(samples, scene)) throw new Error('未知自测场景')
    testing = true
    add({ type: 'self-test', level: 'warning', connectionId: '本机自测', summary: '开始发送合成数据；随后连接和计数包含本机自测，不代表硬件上报' })
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port: config.tcpPort })
        testSockets.add(socket)
        let error
        let finishTimer
        socket.setTimeout(5000, () => socket.destroy(new Error('本机自测超时')))
        socket.once('connect', () => {
          socket.write(samples[scene])
          finishTimer = setTimeout(() => socket.end(), scene === 'missing' ? 1600 : 300)
        })
        socket.on('error', value => { error = value })
        socket.once('close', () => { clearTimeout(finishTimer); testSockets.delete(socket); error ? reject(error) : resolve() })
      })
    } finally { testing = false }
  }

  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] }
  const server = http.createServer(async (req, res) => {
    const port = server.address().port
    const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
    if (!hosts.includes(req.headers.host)) return json(403, { error: '仅允许本机监控地址' })
    if (req.headers.origin && !origins.includes(req.headers.origin)) return json(403, { error: '不接受其他网站请求' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '不接受跨站请求' })
    const pathname = new URL(req.url, origins[0]).pathname
    if (req.method === 'GET' && files[pathname]) {
      const [name, type] = files[pathname]
      let content = fs.readFileSync(path.join(__dirname, 'monitor-ui', name), 'utf8')
      if (pathname === '/') content = content.replace('__MONITOR_TOKEN__', token)
      res.writeHead(200, { 'Content-Type': type }); res.end(content); return
    }
    // Separate, least-privilege credentials for the local Mini Program. A lab
    // token cannot control the receiver, tunnel, raw inspector or monitor data.
    if (pathname.startsWith('/lab/v1/')) {
      if (req.method !== 'POST' || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(400, { ok: false, error: { code: 'INVALID_REQUEST', message: '联调接口仅接受 JSON POST' } })
      try {
        const parts = []; let size = 0
        for await (const part of req) { size += part.length; if (size > 1024) { json(413, { ok: false, error: { code: 'TOO_LARGE', message: '请求过大' } }); req.destroy(); return }; parts.push(part) }
        const body = JSON.parse(Buffer.concat(parts).toString() || '{}')
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
        let data
        if (pathname === '/lab/v1/pair') data = lab.pair(body.code)
        else { lab.authorize(req.headers['x-lab-token']); data = lab.dispatch(pathname.slice('/lab/v1/'.length), body) }
        return json(200, { ok: true, data, serverTime: config.now() })
      } catch (e) { return json(e.code === 'RATE_LIMIT' ? 429 : 400, { ok: false, error: { code: e.code || 'INVALID_REQUEST', message: e.code ? e.message : '联调请求格式错误' } }) }
    }
    const offered = Buffer.from(String(req.headers['x-monitor-token'] || ''))
    const expected = Buffer.from(token)
    if (offered.length !== expected.length || !crypto.timingSafeEqual(offered, expected)) return json(403, { error: '请从本机监控首页重新打开' })
    if (req.method === 'GET' && pathname === '/api/state') return json(200, snapshot())
    if (req.method !== 'POST') return json(404, { error: '不存在的接口' })
    if (!origins.includes(req.headers.origin) || req.headers['content-type'] !== 'application/json') return json(403, { error: '操作须来自本机页面' })
    try {
      const parts = []; let bytes = 0
      for await (const part of req) {
        bytes += part.length
        if (bytes > 1024) { json(413, { error: '请求过大' }); req.destroy(); return }
        parts.push(part)
      }
      const body = JSON.parse(Buffer.concat(parts).toString() || '{}')
      if (pathname === '/api/lab/pairing') {
        return json(200, lab.configure(body))
      } else if (pathname === '/api/lab/revoke') {
        lab.revoke()
      } else if (pathname === '/api/lab/call') {
        lab.controlCall(body.action, body.callId)
      } else if (pathname === '/api/tunnel/start' || pathname === '/api/tunnel/stop') {
        if (!tunnelControl || config.secured || config.tcpPort !== 18765) return json(409, { error: '当前配置不支持窗口公网测试；仅限默认端口的合成数据模式' })
        if (pathname.endsWith('/start')) {
          if (!receiver.snapshot().running || receiverControlBusy) return json(409, { error: '请先开启本机接收' })
          try { tunnelControl.start(body) } catch (error) { return json(409, { error: error.message }) }
        } else {
          try { await tunnelControl.stop() } catch (error) { return json(409, { error: error.message }) }
        }
      } else if (pathname === '/api/receiver/start' || pathname === '/api/receiver/stop') {
        if (receiverControlBusy || testing) return json(409, { error: '正在切换或自测，请稍后重试' })
        receiverControlBusy = true
        try {
          if (pathname.endsWith('/start')) {
            if (!receiver.snapshot().running) {
              const address = await receiver.start()
              config.tcpPort = address.port
              add({ type: 'receiver-start', level: 'info', connectionId: '服务', summary: '本机接收已开启；未自动开启公网穿透' })
            }
          } else {
            await receiver.stop()
            raw.clear(); revealUntil = 0
            add({ type: 'receiver-stop', level: 'warning', connectionId: '服务', summary: '本机接收已停止，连接已断开；监控窗口仍可使用' })
          }
        } catch (error) {
          return json(409, { error: error.code === 'EADDRINUSE' ? '接收端口被占用，未能开启；请先关闭另一份接收程序' : '接收状态切换未完成，请稍后重试' })
        } finally { receiverControlBusy = false }
      } else if (pathname === '/api/reveal') {
        if (body.confirmLocalOnly !== true) return json(400, { error: '请先确认只在本机临时查看' })
        raw.clear(); revealUntil = config.now() + 60000
      } else if (pathname === '/api/hide') {
        revealUntil = 0; raw.clear()
      } else if (pathname === '/api/clear') {
        rows = []; raw.clear()
      } else if (pathname === '/api/test') {
        await selfTest(body.scene)
      } else if (pathname === '/api/media/event') {
        return json(200, media.ingest(body))
      } else if (pathname === '/api/media/simulate') {
        media.simulate(body.mediaType, body.outcome)
      } else if (pathname === '/api/media/stop') {
        media.stopSimulation()
      } else if (pathname === '/api/media/clear') {
        media.clear()
      } else return json(404, { error: '不存在的操作' })
      return json(200, { ok: true })
    } catch (_) { if (!res.headersSent) json(400, { error: '操作未完成，请检查接收服务或稍后重试' }) }
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.keepAliveTimeout = 1000
  server.on('connection', socket => {
    if (clients.size >= 16) return socket.destroy()
    clients.add(socket); socket.once('close', () => clients.delete(socket))
  })
  return {
    async start() {
      await new Promise((resolve, reject) => {
        const error = e => { server.off('listening', listening); reject(e) }
        const listening = () => { server.off('error', error); resolve() }
        server.once('error', error); server.once('listening', listening)
        server.listen(config.port, '127.0.0.1')
      })
      pruneTimer = setInterval(prune, 1000); pruneTimer.unref()
      return `http://127.0.0.1:${server.address().port}`
    },
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(pruneTimer)
      if (tunnelControl) await tunnelControl.stop('监控程序退出，公网已关闭')
      lab.stop(); media.stop()
      receiver.events.off('event', onEvent); receiver.events.off('diagnostic', onDiagnostic)
      rows = []; raw.clear(); revealUntil = 0
      for (const socket of testSockets) socket.destroy()
      for (const socket of clients) socket.destroy()
      await new Promise(resolve => server.listening ? server.close(resolve) : resolve())
    }
  }
}

module.exports = { createMonitor, readTunnelStatus }
