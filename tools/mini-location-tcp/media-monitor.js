'use strict'

// Observation only: never creates a media room, accesses devices or starts a call.
function createMediaMonitor(now = Date.now) {
  const sessions = new Map()
  let events = []
  let timer = null
  const states = ['preparing', 'calling', 'ringing', 'connecting', 'connected', 'ending', 'ended']
  const sources = ['client', 'device', 'gateway', 'sdk']
  const limits = { rttMs: 60000, jitterMs: 60000, packetLossPct: 100, audioKbps: 100000, videoKbps: 100000, fps: 240 }
  function prune() {
    for (const [key, value] of sessions) if (now() - value.updatedAt > 600000) sessions.delete(key)
    events = events.filter(e => now() - e.receivedAt < 600000).slice(-120)
  }
  function ingest(input, simulated = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('需要事件对象')
    const allowed = ['callId', 'mediaType', 'source', 'seq', 'state', 'childAccepted', 'mediaReady', 'videoReady', 'errorCode', 'metrics']
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('包含不支持的字段；不要传媒体内容、令牌、SDP 或个人信息')
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.callId || '')) throw new Error('callId 须使用脱敏联调编号')
    if (!['voice', 'video'].includes(input.mediaType) || !sources.includes(input.source) || !states.includes(input.state)) throw new Error('类型、来源或状态不正确')
    if (!Number.isSafeInteger(input.seq) || input.seq < 0) throw new Error('seq 必须是来源内递增的非负整数')
    for (const k of ['childAccepted', 'mediaReady', 'videoReady']) if (input[k] !== undefined && typeof input[k] !== 'boolean') throw new Error('确认字段须为布尔值')
    if (input.errorCode !== undefined && !/^[A-Z0-9_]{1,48}$/.test(input.errorCode)) throw new Error('只接收脱敏错误码')
    const metrics = {}
    if (input.metrics !== undefined) {
      if (!input.metrics || typeof input.metrics !== 'object' || Array.isArray(input.metrics)) throw new Error('指标格式错误')
      for (const [key, value] of Object.entries(input.metrics)) {
        if (!Object.hasOwn(limits, key) || !Number.isFinite(value) || value < 0 || value > limits[key]) throw new Error('指标字段或范围错误')
        metrics[key] = value
      }
    }
    prune()
    const key = (simulated ? 'demo:' : 'ingest:') + input.callId
    let session = sessions.get(key)
    if (session && session.mediaType !== input.mediaType) throw new Error('同一会话不能变更媒体类型')
    if (!session) {
      if (sessions.size >= 24) throw new Error('会话数量达到上限，请清理或等待过期')
      session = { key, callId: input.callId, mediaType: input.mediaType, simulated, state: 'preparing', seqs: {}, updatedAt: now(), startedAt: now(), connectedAt: null, endedAt: null,
        childAccepted: false, mediaReady: false, videoReady: false, confirmed: false, metrics: {}, errorCode: null }
      sessions.set(key, session)
    }
    let ignored = null
    if (input.seq <= (session.seqs[input.source] ?? -1)) ignored = '重复或乱序事件'
    else {
      session.seqs[input.source] = input.seq
      if (session.state === 'ended' && input.state !== 'ended') ignored = '会话已结束，不恢复接通'
      else if (states.indexOf(input.state) < states.indexOf(session.state)) ignored = '迟到的状态，不回退'
    }
    const event = { ...input, metrics, simulated, receivedAt: now(), ignored }
    events.push(event)
    events = events.slice(-120)
    if (!ignored) {
      session.updatedAt = now()
      session.state = input.state
      session.errorCode = input.errorCode || session.errorCode
      // Reported flags are NOT independent authentication of hardware or consent.
      if (input.source === 'gateway' || input.source === 'device') {
        for (const k of ['childAccepted', 'mediaReady', 'videoReady']) if (input[k] !== undefined) session[k] = input[k]
      }
      session.confirmed = input.state === 'connected' && session.childAccepted && session.mediaReady && (input.mediaType !== 'video' || session.videoReady)
      if (session.confirmed && session.connectedAt === null) session.connectedAt = now()
      if (input.state === 'ended' && session.endedAt === null) session.endedAt = now()
      if (Object.keys(metrics).length) session.metrics = { values: metrics, source: input.source, receivedAt: now() }
    }
    return { accepted: !ignored, reason: ignored }
  }
  function simulate(mediaType, outcome) {
    if (!['voice', 'video'].includes(mediaType) || !['normal', 'rejected', 'offline', 'timeout'].includes(outcome)) throw new Error('模拟场景不正确')
    if (timer) throw new Error('模拟正在进行，请先停止')
    const callId = 'demo-' + now()
    const flow = ['preparing', 'calling', 'ringing', 'connecting', 'connected', 'ended']
    if (outcome !== 'normal') flow.splice(3, 3, 'ended')
    let seq = 0
    function step() {
      const state = flow[seq++]
      ingest({ callId, mediaType, source: 'gateway', seq, state,
        ...(state === 'connected' ? { childAccepted: true, mediaReady: true, videoReady: mediaType === 'video', metrics: { rttMs: 85, jitterMs: 12, packetLossPct: 0.6, audioKbps: 32, ...(mediaType === 'video' ? { videoKbps: 850, fps: 24 } : {}) } } : {}),
        ...(state === 'ended' && outcome !== 'normal' ? { errorCode: { rejected: 'REJECTED', offline: 'DEVICE_OFFLINE', timeout: 'NO_ANSWER' }[outcome] } : {}) }, true)
      timer = seq < flow.length ? setTimeout(step, state === 'connected' ? 5000 : 1300) : null
    }
    step()
    return callId
  }
  function stopSimulation() {
    clearTimeout(timer); timer = null
    for (const session of sessions.values()) if (session.simulated && session.state !== 'ended') {
      ingest({ callId: session.callId, mediaType: session.mediaType, source: 'gateway', seq: (session.seqs.gateway || 0) + 1, state: 'ended', errorCode: 'LOCAL_CANCELLED' }, true)
    }
  }
  return { ingest, simulate, stopSimulation,
    snapshot() { prune(); return { sessions: [...sessions.values()].map(({ seqs, ...rest }) => rest), events: [...events], simulating: Boolean(timer), connectedToHardware: false } },
    clear() { stopSimulation(); sessions.clear(); events = [] },
    stop() { clearTimeout(timer); timer = null; sessions.clear(); events = [] }
  }
}

module.exports = { createMediaMonitor }
