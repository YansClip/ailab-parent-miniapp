'use strict'

// Isolated development bridge, NOT a device cloud or family authorization service.
// A pairing selects one ephemeral TCP connection; neither IMEI nor a child is inferred.
const crypto = require('node:crypto')
const { gcj02 } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const fail = (code, message) => { const e = new Error(message); e.code = code; throw e }
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

function createLabBridge(receiver, media, { now = Date.now } = {}) {
  let pairing = null, session = null, call = null, revision = 0, pending = null
  let attempts = 0, attemptWindow = now()
  const revisions = new Map()
  const cancelledStarts = new Set()
  const retentionMs = 30000 // LAB receive-age only, never a claim about GPS acquisition freshness.
  function report(source, state, errorCode) {
    media.ingest({ callId: call.id, mediaType: call.mediaType, source, seq: ++call.seq, state,
      ...(errorCode ? { errorCode } : {}) }, true)
  }
  function end(reason, source = 'client') {
    if (call && call.state !== 'ended') {
      call.state = 'ended'; call.endedAt = now(); call.reason = reason
      report(source, 'ended', reason)
    }
  }
  function revoke() { end('LAB_DISCONNECTED'); pairing = null; session = null; pending = null; cancelledStarts.clear() }
  function prune() {
    if (pairing && pairing.expiresAt <= now()) pairing = null
    if (session && session.expiresAt <= now()) revoke()
    if (call && call.state !== 'ended' && now() >= call.deadline) end(call.state === 'connected' ? 'LAB_MAX_DURATION' : 'NO_ANSWER', 'gateway')
  }
  const onEvent = event => {
    if (event.type === 'location') revisions.set(event.connectionId, ++revision)
    if (event.type === 'disconnected') revisions.delete(event.connectionId)
  }
  receiver.events.on('event', onEvent)
  function configure(input) {
    if (!input || input.confirm !== true) fail('CONFIRM_REQUIRED', '请确认仅用于本机联调，不绑定真实孩子')
    if (!['UNKNOWN', 'WGS84', 'GCJ02'].includes(input.coordinateSystem)) fail('INVALID_ARGUMENT', '请选择明确的坐标系，未知时不显示地图')
    const connectionId = input.connectionId || null
    if (connectionId && !receiver.snapshot().connections.some(x => x.id === connectionId)) fail('CONNECTION_GONE', '所选连接已断开，请重新选择')
    revoke(); call = null
    pairing = { code: crypto.randomBytes(5).toString('hex').toUpperCase(), connectionId,
      coordinateSystem: input.coordinateSystem, expiresAt: now() + 300000 }
    attempts = 0; attemptWindow = now()
    return { code: pairing.code, expiresAt: pairing.expiresAt }
  }
  function pair(code) {
    prune()
    if (now() - attemptWindow >= 60000) { attempts = 0; attemptWindow = now() }
    if (++attempts > 10) fail('RATE_LIMIT', '配对尝试过多，请一分钟后重试')
    if (!pairing || !/^[A-F0-9]{10}$/.test(code || '') || !equal(code, pairing.code)) fail('PAIRING_INVALID', '配对码错误、已使用或已过期，请在联调台重新生成')
    session = { token: crypto.randomBytes(32).toString('hex'), id: crypto.randomBytes(8).toString('hex'),
      connectionId: pairing.connectionId, coordinateSystem: pairing.coordinateSystem, expiresAt: now() + 1800000 }
    pairing = null
    return { token: session.token, expiresAt: session.expiresAt, sessionId: session.id }
  }
  function authorize(token) {
    prune()
    if (!session || !/^[a-f0-9]{64}$/.test(token || '') || !equal(token, session.token)) fail('LAB_UNPAIRED', '本机配对已失效，请回体验设置重新配对')
  }
  function location() {
    const peer = receiver.snapshot().connections.find(x => session && x.id === session.connectionId)
    const record = peer && peer.latest
    const age = record ? now() - record.receivedAt : Infinity
    const status = !session.connectionId ? 'unselected' : !peer ? 'offline' : !record ? 'waiting' :
      !['delimited', 'fixed'].includes(record.framing) ? 'unframed' : age < 0 || age >= retentionMs ? 'stale' :
        session.coordinateSystem === 'UNKNOWN' ? 'coordinate-unknown' : 'lab-point'
    const point = status === 'lab-point' ? session.coordinateSystem === 'WGS84' ? gcj02(record.latitude, record.longitude) :
      { latitude: record.latitude, longitude: record.longitude } : null
    return { status, point, address: null, receivedAt: record ? record.receivedAt : null, measuredAt: null, accuracyM: null,
      remainingMs: point ? Math.max(0, retentionMs - age) : 0, coordinateSystem: 'GCJ02', inputCoordinateSystem: session.coordinateSystem,
      connectionId: session.connectionId, connected: Boolean(peer), deviceOnline: null, battery: null,
      identityVerified: false, productionReady: false, revision: revisions.get(session.connectionId) || 0, serverTime: now() }
  }
  function publicCall() {
    if (!call) return null
    const reasons = { REJECTED: '模拟设备拒接', BUSY: '模拟设备忙线', NO_ANSWER: '模拟等待接听超时',
      INTERRUPTED: '模拟网络中断', FAILED: '模拟连接失败', DEVICE_OFFLINE: '模拟设备离线',
      PARENT_ENDED: '家长已结束本机模拟', DEVICE_ENDED: '模拟设备挂断', LAB_DISCONNECTED: '本机联调配对已结束', LAB_MAX_DURATION: '本机模拟时长已到期' }
    return { id: call.id, state: call.state, mediaType: call.mediaType, connectedAt: call.connectedAt,
      endedAt: call.endedAt, endReason: call.reason, reason: reasons[call.reason] || null, simulated: true,
      deadline: call.deadline, childAccepted: false, mediaReady: false, videoReady: false }
  }
  function startCall(type, requestId) {
    if (!['voice', 'video'].includes(type) || !/^[a-z0-9-]{1,80}$/.test(requestId || '')) fail('INVALID_ARGUMENT', '通话类型或请求编号错误')
    if (cancelledStarts.has(requestId)) fail('CALL_CANCELLED', '这次呼叫准备已取消，请重新发起')
    if (call && call.requestId === requestId) return publicCall()
    if (call && call.state !== 'ended') {
      if (call.mediaType !== type) fail('CALL_ACTIVE', '请先结束原模拟会话，再切换通话类型')
      return publicCall()
    }
    call = { id: 'lab-' + crypto.randomBytes(8).toString('hex'), requestId, mediaType: type, state: 'calling', seq: 0,
      deadline: now() + 30000, connectedAt: null, endedAt: null, reason: null }
    report('client', 'calling')
    return publicCall()
  }
  function controlCall(action, callId) {
    prune()
    if (!session || !call || call.id !== callId || call.state === 'ended') fail('CALL_NOT_ACTIVE', '会话已变化，请刷新后重试')
    const errors = { rejected: 'REJECTED', busy: 'BUSY', timeout: 'NO_ANSWER', failed: 'FAILED', interrupted: 'INTERRUPTED', offline: 'DEVICE_OFFLINE', end: 'DEVICE_ENDED' }
    if (errors[action]) { end(errors[action], 'gateway'); return publicCall() }
    const next = { ringing: ['calling', 'ringing'], accept: ['ringing', 'connecting'], connected: ['connecting', 'connected'] }[action]
    if (!next || call.state !== next[0]) fail('INVALID_TRANSITION', '请按响铃 → 模拟接听 → 模拟连接顺序操作')
    call.state = next[1]
    if (call.state === 'connected') { call.connectedAt = now(); call.deadline = now() + 600000 }
    report('gateway', call.state) // Intentionally no real child/media confirmation flags.
    return publicCall()
  }
  function dispatch(action, body = {}) {
    if (action === 'snapshot') return location()
    if (action === 'watch') return { pollMs: 2000 }
    if (action === 'unwatch') return { stopped: true } // Stops querying only, never claims to stop GNSS.
    if (action === 'refresh') {
      if (typeof body.requestId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(body.requestId)) fail('INVALID_ARGUMENT', '请求编号错误')
      if (!session.connectionId) fail('CONNECTION_REQUIRED', '请先在联调台选择 TCP 连接并重新配对')
      if (!pending || pending.id !== body.requestId) pending = { id: body.requestId, revision: revisions.get(session.connectionId) || 0, createdAt: now(), expiresAt: now() + 20000 }
      const l = location()
      // Same numbers in a NEW report are valid reception, not proof of new GPS acquisition.
      const received = l.status === 'lab-point' && l.revision > pending.revision && l.receivedAt >= pending.createdAt
      return { id: pending.id, state: received ? 'success' : now() >= pending.expiresAt ? 'timeout' : 'executing',
        message: received ? '已收到下一条上报，非主动定位结果' : '仅等待下一条上报，未向设备下发指令', expiresAt: pending.expiresAt }
    }
    if (action === 'call.get') return publicCall()
    if (action === 'call.start') return startCall(body.mediaType, body.requestId)
    if (action === 'call.end') {
      if (body.requestId) {
        if (!/^[a-z0-9-]{1,80}$/.test(body.requestId)) fail('INVALID_ARGUMENT', '请求编号错误')
        // A cancellation can arrive before call.start over separate HTTP requests.
        // Keep a bounded tombstone so a late start cannot resurrect a cancelled call.
        if (cancelledStarts.size >= 100 && !cancelledStarts.has(body.requestId)) fail('RATE_LIMIT', '取消次数过多，请重新配对')
        cancelledStarts.add(body.requestId)
        if (!call || call.requestId !== body.requestId) return null
      } else if (!body.callId) return null
      if (body.callId && (!call || call.id !== body.callId)) fail('CALL_CHANGED', '会话已变化，不结束其他会话')
      end('PARENT_ENDED'); return publicCall()
    }
    if (action === 'disconnect') { revoke(); return { disconnected: true } }
    fail('NOT_FOUND', '不存在的联调接口')
  }
  return { configure, pair, authorize, dispatch, controlCall, revoke,
    snapshot() { prune(); return { paired: Boolean(session), connectionId: session?.connectionId || pairing?.connectionId || null,
      coordinateSystem: session?.coordinateSystem || pairing?.coordinateSystem || 'UNKNOWN',
      expiresAt: session?.expiresAt || null, pairingExpiresAt: pairing?.expiresAt || null, call: publicCall(),
      // No pairing code, tokens or coordinates in the normal monitoring snapshot.
      capabilities: { locationRefreshCommand: false, realVoice: false, realVideo: false } } },
    stop() { revoke(); revisions.clear(); receiver.events.off('event', onEvent) }
  }
}
module.exports = { createLabBridge }
