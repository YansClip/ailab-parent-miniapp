const ACTIVE_KEY = 'ailab.device.active-call.v1'
const { createDeviceTransport } = require('./transport')
const errors = (code, message) => ({ code, message })
function createDeviceClient({ config, store, wxApi, media, authorizeCall, clock = Date.now }) {
  const transport = createDeviceTransport({ config, wxApi })
  let targets = [], selected = null, generation = 0, listening = false, sequence = 0, preparing = null
  let active = null, watchScope = null, pendingRefresh = null, callReport = Promise.resolve(), callVersion = 0
  function requestId() { return 'r-' + clock() + '-' + (++sequence) + '-' + Math.random().toString(36).slice(2,10) }
  function token() { return { generation, epoch: store.getEpoch() } }
  function current(t) { return t.generation === generation && t.epoch === store.getEpoch() && store.getSession().privacyAccepted }
  function init() {
    if (config.mode !== 'cloud') throw errors('CONFIG_REQUIRED', '真实设备模式未启用，不自动切换到模拟成功')
    transport.init()
  }
  async function rpc(action, payload, { cleanup = false } = {}) {
    init()
    if (!cleanup && !store.getSession().privacyAccepted) throw errors('PRIVACY_REQUIRED', '请先确认隐私规则')
    const t = token()
    let timer, timedOut = false
    try {
      const invocation = transport.invoke(action, payload)
      // A timed-out call.prepare may still finish on the server. Compensate late
      // reservations instead of leaving an invisible call/lock behind.
      invocation.then(result => {
        if (action === 'call.prepare' && (timedOut || !current(t)) && result.result && result.result.ok && result.result.data && result.result.data.id) {
          void rpc('call.end', { callId: result.result.data.id }, { cleanup: true }).catch(() => {})
        }
      }).catch(() => {})
      const result = await Promise.race([
        invocation,
        new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(errors('REQUEST_TIMEOUT', '请求结果尚未确认，请查询原操作，不要重复提交')) }, config.requestTimeoutMs) })
      ])
      if (!cleanup && !current(t)) throw errors('STALE_CONTEXT', '当前孩子或授权已改变，请重新加载')
      const body = result && result.result
      if (!body || body.ok !== true) throw body && body.error || errors('INVALID_RESPONSE', '设备服务返回内容异常')
      return body.data
    } catch (e) {
      if (e && e.code) throw e
      throw errors('NETWORK_ERROR', '设备服务暂不可用，请检查网络后重试')
    } finally { if (timer) clearTimeout(timer) }
  }
  function persist() {
    // IDs only, never location, media, tokens or family profile.
    if (active) wxApi.setStorageSync(ACTIVE_KEY, { ...active, connectionKey: transport.key() })
    else wxApi.removeStorageSync && wxApi.removeStorageSync(ACTIVE_KEY)
  }
  function restore() {
    if (!active) {
      const a = wxApi.getStorageSync(ACTIVE_KEY)
      const matches = a && (a.connectionKey ? a.connectionKey === transport.key() : (config.transport || 'function') === 'function' && a.envId === config.envId)
      if (a && a.callId && a.scope && matches) active = a
    }
    return active
  }
  function scope() { if (!selected) throw errors('DEVICE_UNBOUND', '暂无已授权设备，请由管理员完成真实绑定'); return { familyId: selected.familyId, childId: selected.childId, deviceId: selected.deviceId, bindingVersion: selected.bindingVersion } }
  function presentCall(c) {
    if (!c) return null
    const reason = { rejected: 'rejected', busy: 'busy', 'no-answer': 'timeout', interrupted: 'interrupted', failed: 'failed', offline: 'interrupted' }
    return { ...c, stage: c.state === 'ended' ? reason[c.endReason] || 'ended' : c.state, isDemo: false }
  }
  async function loadTargets() {
    const rows = await rpc('context.list', {})
    if (!Array.isArray(rows)) throw errors('INVALID_RESPONSE', '设备授权列表异常')
    targets = rows
    restore()
    const wanted = selected || active && active.scope
    const next = rows.find(x => wanted && x.deviceId === wanted.deviceId && x.bindingVersion === wanted.bindingVersion)
    if (active && !rows.some(x => x.deviceId === active.scope.deviceId && x.bindingVersion === active.scope.bindingVersion)) await cleanup()
    selected = next || rows[0] || null
    return rows.map(x => ({ id: x.deviceId, name: x.child.name, shortName: x.child.shortName, deviceName: x.deviceName, avatarColor: '#227BB8', online: null }))
  }
  async function snapshot() {
    if (!selected) await loadTargets()
    const d = await rpc('device.snapshot', { scope: scope() }), l = d.location
    if (!l || l.coordinateSystem !== 'GCJ02') throw errors('INVALID_RESPONSE', '位置坐标系未明确，已停止显示')
    const valid = l.displayable === true && l.status === 'valid' && d.online && l.point && Number.isFinite(l.point.latitude) && Number.isFinite(l.point.longitude) && Math.abs(l.point.latitude) <= 90 && Math.abs(l.point.longitude) <= 180 && l.expiresAt > d.serverTime
    return { ...d, isDemo: false, point: valid ? l.point : null, status: valid ? 'valid' : l.status === 'valid' ? 'unavailable' : l.status,
      label: valid ? l.address || '设备当前位置' : l.status === 'offline' ? '设备离线' : l.status === 'stale' ? '位置已过期' : '暂无有效位置',
      hint: d.locationHint || '旧点位和地址已清除，请检查设备状态后刷新。显示的是设备位置，不保证设备正在随身佩戴。',
      fixId: l.fixId, updatedAt: l.measuredAt, accuracy: l.accuracyM, expiresAt: l.expiresAt,
      // Use the server's clock offset; do not trust a wrong phone date for freshness.
      receivedAt: clock(), serverTime: d.serverTime, remainingMs: Math.max(0, l.expiresAt - d.serverTime) }
  }
  async function watch(stop, lease) {
    if (!selected && !stop) await loadTargets()
    if (!stop && !watchScope) watchScope = { scope: scope(), requestId: requestId() }
    const handle = stop ? lease || watchScope : watchScope
    if (!handle) return null
    if (stop && watchScope && watchScope.requestId === handle.requestId) watchScope = null
    const data = await rpc(stop ? 'location.unwatch' : 'location.watch', handle, { cleanup: stop })
    return { ...data, ...handle }
  }
  async function refresh() {
    if (!selected) await loadTargets()
    const s = scope(), t = token()
    if (!pendingRefresh) pendingRefresh = { requestId: requestId(), scope: s }
    const saved = pendingRefresh
    const op = saved.operationId ? await rpc('operation.get', { scope: saved.scope, operationId: saved.operationId }) : await rpc('location.refresh', saved)
    if (!current(t)) throw errors('STALE_CONTEXT', '当前主体已改变')
    saved.operationId = op.id
    if (['success', 'failed', 'cancelled'].includes(op.state) || op.state === 'timeout' && op.refreshMode === 'wait-next-report') pendingRefresh = null
    return op
  }
  async function getCall() {
    restore()
    if (!active) {
      if (!selected) await loadTargets()
      const s = scope(), found = await rpc('call.current', { scope: s })
      if (!found || found.state === 'ended') return presentCall(found)
      active = { callId: found.id, scope: s, mediaType: found.mediaType, roomId: found.roomId, envId: config.envId }; persist()
      return presentCall(found)
    }
    const saved = { ...active }
    try {
      const c = await rpc('call.get', saved)
      if (c.state === 'ended') {
        try { await media.stop(saved.roomId) }
        catch (_) { return { ...presentCall(c), state: 'ending', stage: 'ending', reason: '设备通话已结束，本机媒体清理尚未确认，请再次结束。' } }
        active = null; persist()
      }
      return presentCall(c)
    } catch(e) {
      if (['FORBIDDEN', 'BINDING_CHANGED', 'NOT_FOUND'].includes(e.code)) {
        const result = await cleanup()
        if (result) return { ...result, reason: '设备授权已改变，本机已尝试停止媒体；请确认结束状态。' }
      }
      throw e
    }
  }
  function listen() {
    if (listening) return
    media.listen(event => {
      if (!active || !event.roomId) return
      const saved = { ...active }
      callReport = callReport.catch(() => {}).then(async () => {
        if (!active || active.callId !== saved.callId || (active.roomId && active.roomId !== event.roomId)) return
        // Server validates the bound room. Early events are reconciled via call.get.
        if (!active.roomId) return
        await rpc('call.event', { ...saved, roomId: event.roomId, eventName: event.eventName }, { cleanup: true })
      }).catch(() => { /* UI queries authoritative state; no raw SDK logs. */ })
    })
    listening = true
  }
  async function start(mediaType) {
    if (preparing) return preparing
    preparing = (async () => {
      const attempt = ++callVersion
      media.ensure()
      if (!selected) await loadTargets()
      if (attempt !== callVersion) throw errors('CALL_CANCELLED', '呼叫准备已取消')
      restore()
      if (active) {
        const c = await getCall()
        if (c && c.state !== 'ended') {
          if (c.deviceId !== selected.deviceId || c.mediaType !== mediaType) throw errors('CALL_ACTIVE', '请先结束当前通话，再切换设备或通话类型')
          return c
        }
      }
      const t = token(), s = scope()
      if (authorizeCall) await authorizeCall(s)
      if (attempt !== callVersion || !current(t)) throw errors('CALL_CANCELLED', '呼叫授权检查已取消')
      const c = await rpc('call.prepare', { scope: s, mediaType, requestId: requestId() })
      if (attempt !== callVersion) {
        await rpc('call.end', { callId: c.id }, { cleanup: true })
        throw errors('CALL_CANCELLED', '呼叫准备已取消')
      }
      if (c.state === 'ended') throw errors('CALL_EXPIRED', '本次呼叫已结束，请重新发起')
      active = { callId: c.id, scope: s, mediaType, roomId: c.roomId, envId: config.envId }
      persist(); listen()
      try {
        const roomId = await media.create(c)
        if (attempt !== callVersion || !current(t) || !active || active.callId !== c.id) {
          try { await media.stop(roomId) } catch (_) { /* Keep backend cleanup independent of plugin errors. */ }
          await rpc('call.end', { callId: c.id }, { cleanup: true }); throw errors('STALE_CONTEXT', '通话已取消')
        }
        active.roomId = roomId; persist()
        const attached = await rpc('call.attach', { scope: s, callId: c.id, roomId })
        if (!current(t)) throw errors('STALE_CONTEXT', '通话已取消')
        await media.show()
        return presentCall(attached)
      } catch(e) {
        await cleanup()
        throw e && e.code ? e : errors('MEDIA_FAILED', '通话组件未启动，请检查麦克风、摄像头权限及微信通话配置')
      }
    })().finally(() => { preparing = null })
    return preparing
  }
  async function cleanup() {
    callVersion++
    restore()
    if (!active) return null
    const saved = { ...active }
    let localStopped = true
    try { await media.stop(saved.roomId) } catch (_) { localStopped = false }
    try {
      const c = await rpc('call.end', saved, { cleanup: true })
      if (!localStopped) return { ...presentCall(c), stage:'ending', state:'ending', reason:'本机媒体清理尚未确认，请再次结束；已同步请求设备结束。' }
      if (active && active.callId === saved.callId && c.state === 'ended') { active = null; persist() }
      return presentCall(c)
    } catch (_) { return { stage: 'ending', state: 'ending', mediaType: saved.mediaType, reason: '本机已尝试停止媒体，设备结束结果待确认，请重新查询' } }
  }
  async function select(deviceId) {
    const next = targets.find(x => x.deviceId === deviceId)
    if (!next) throw errors('DEVICE_UNBOUND', '所选设备不在授权列表中')
    restore()
    if (active && active.scope.deviceId !== deviceId) {
      const c = await getCall()
      if (c && c.state !== 'ended') throw errors('CALL_ACTIVE', '请先结束当前通话，再切换设备')
    }
    await watch(true).catch(() => {})
    generation++; selected = next; pendingRefresh = null
  }
  function invalidate() { generation++; targets = []; selected = null; pendingRefresh = null; void watch(true).catch(() => {}); void cleanup() }
  return { loadTargets, snapshot, watch, refresh, getCall, start, cleanup, select, invalidate,
    async status() { if (!selected) await loadTargets(); return rpc('device.status', { scope: scope() }) },
    showCall: () => media.show(), selectedId: () => selected && selected.deviceId || '',
    request: rpc, dispose: () => { invalidate(); media.dispose(); listening = false } }
}
module.exports = { createDeviceClient }
