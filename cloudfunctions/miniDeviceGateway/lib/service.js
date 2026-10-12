const { fail, id, roomId, key, scopeOf, sameScope, policy, location, terminal, publicCall } = require('./contracts')
const C = { members: 'mini_memberships', bindings: 'mini_bindings', locations: 'mini_current_locations', watches: 'mini_location_watches', operations: 'mini_operations', calls: 'mini_calls', locks: 'mini_call_locks', receipts: 'mini_event_receipts' }
function createService({ repo, provider, config, now = Date.now }) {
  function identity(user) {
    if (!user || !user.openid || user.appid !== config.appid) fail('AUTH_REQUIRED', '微信身份无效，请重新进入小程序')
    return user
  }
  async function contexts(user) {
    identity(user)
    const members = await repo.list(C.members, { openid: user.openid, active: true })
    const out = []
    for (const member of members) {
      if (!member.consentActive) continue
      const bindings = await repo.list(C.bindings, { familyId: member.familyId, active: true })
      for (const b of bindings) if (Array.isArray(member.childIds) && member.childIds.includes(b.childId) && member.permissions && member.permissions.viewDevice === true) {
        out.push(Object.assign(scopeOf(b), { child: { id: b.childId, name: b.childName || '孩子', shortName: b.childName || '孩子' }, deviceName: b.deviceName || 'Mini', permissions: member.permissions }))
      }
    }
    return out
  }
  async function authorize(user, s, permission = 'viewDevice', reader = repo) {
    identity(user)
    if (!s) fail('SCOPE_REQUIRED', '请先选择已授权设备')
    id(s.deviceId, '设备 ID')
    const binding = await reader.get(C.bindings, s.deviceId)
    if (!binding || !binding.active || !Number.isSafeInteger(binding.bindingVersion) || binding.bindingVersion < 1 || !sameScope(binding, s)) fail('BINDING_CHANGED', '设备绑定已改变，请重新选择')
    const memberships = await reader.list(C.members, { openid: user.openid, familyId: binding.familyId, active: true })
    const member = memberships.find(m => m.consentActive && Array.isArray(m.childIds) && m.childIds.includes(binding.childId) && m.permissions && m.permissions[permission] === true)
    if (!member) fail('FORBIDDEN', '没有此孩子或设备的访问权限，或授权已撤回')
    return binding
  }
  async function device(binding) {
    policy(config)
    const data = await provider.getDevice(scopeOf(binding))
    if (!data || data.deviceId !== binding.deviceId || data.bindingVersion !== binding.bindingVersion) fail('BINDING_CHANGED', '设备状态与当前设备或绑定版本不一致')
    const fresh = Number.isSafeInteger(data.stateTime) && data.stateTime <= now() + 5000 && data.stateTime + config.statusTtlMs > now()
    return { ...scopeOf(binding), child: { id: binding.childId, name: binding.childName || '孩子', shortName: binding.childName || '孩子' },
      deviceName: binding.deviceName || 'Mini', online: fresh && data.online === true, stateTime: data.stateTime || null,
      battery: Number.isFinite(data.battery) && data.battery >= 0 && data.battery <= 100 ? data.battery : null,
      charging: typeof data.charging === 'boolean' ? data.charging : null, network: data.network || 'unknown', callBusy: data.callBusy === true,
      refreshMode: data.refreshMode === 'wait-next-report' ? 'wait-next-report' : 'request-fix', locationHint: typeof data.locationHint === 'string' ? data.locationHint.slice(0, 200) : '',
      capabilities: { location: data.capabilities && data.capabilities.location === true, voice: data.capabilities && data.capabilities.voice === true, video: data.capabilities && data.capabilities.video === true }, serverTime: now(), pollMs: config.pollMs }
  }
  async function storeLocation(binding, raw) {
    if (!raw || raw.deviceId !== binding.deviceId || raw.bindingVersion !== binding.bindingVersion) fail('BINDING_CHANGED', '定位结果属于其他设备或旧绑定')
    if (!Number.isSafeInteger(raw.measuredAt) || raw.measuredAt > now() + 5000) fail('INVALID_LOCATION', '定位采集时间无效')
    id(raw.fixId, '定位记录 ID')
    // Only the latest fix exists; no history, no raw location in operation/event records.
    return repo.transaction(async tx => {
      const latestBinding = await tx.get(C.bindings, binding.deviceId)
      if (!latestBinding || !latestBinding.active || !sameScope(latestBinding, binding)) fail('BINDING_CHANGED', '设备绑定已改变')
      if (raw.pushRecord === true) {
        const channel = await tx.get('mini_location_channels', binding.deviceId)
        if (!channel || !sameScope(channel, binding) || !channel.online || channel.lastSeenAt + config.statusTtlMs <= now() || !channel.position || channel.position.fixId !== raw.fixId) return null
      }
      const old = await tx.get(C.locations, binding.deviceId)
      if (old && old.bindingVersion === binding.bindingVersion && old.measuredAt > raw.measuredAt) return old
      if (old && old.bindingVersion === binding.bindingVersion && old.measuredAt === raw.measuredAt && raw.status === 'valid') return old
      const value = { ...scopeOf(binding), fixId: raw.fixId, measuredAt: raw.measuredAt, status: raw.status,
        latitude: raw.status !== 'valid' || raw.latitude == null ? null : raw.latitude, longitude: raw.status !== 'valid' || raw.longitude == null ? null : raw.longitude,
        coordinateSystem: raw.coordinateSystem || 'unknown', accuracyM: raw.accuracyM == null ? null : raw.accuracyM,
        source: raw.source || 'unknown', address: raw.status === 'valid' ? raw.address || null : null, expiresAt: raw.measuredAt + config.locationTtlMs }
      await tx.put(C.locations, binding.deviceId, value)
      return value
    })
  }
  async function snapshot(user, s) {
    const b = await authorize(user, s, 'locateDevice'), d = await device(b)
    let raw = null
    if (d.online && d.capabilities.location) {
      raw = await provider.getLocation(scopeOf(b))
      if (raw) raw = await storeLocation(b, raw)
    }
    // Recheck ACL after upstream I/O, before returning sensitive data.
    await authorize(user, s, 'locateDevice')
    const loc = location(raw, d, config, now())
    if (loc.displayable) loc.expiresAt = Math.min(loc.expiresAt, d.stateTime + config.statusTtlMs)
    return { ...d, location: loc }
  }
  async function watch(user, p, stop) {
    const b = await authorize(user, p.scope, 'locateDevice')
    policy(config)
    id(p.requestId, '订阅编号')
    const watchId = key(user.openid, scopeOf(b), 'watch', p.requestId)
    const value = { ...scopeOf(b), id: watchId, openid: user.openid, expiresAt: stop ? now() : now() + config.watchLeaseMs, pollMs: config.pollMs }
    if (!stop) { const d = await device(b); if (!d.online) fail('DEVICE_OFFLINE', '设备离线，暂不能订阅位置'); if (!d.capabilities.location) fail('UNSUPPORTED', '设备尚不支持定位') }
    await authorize(user, p.scope, 'locateDevice')
    await repo.transaction(async tx => {
      // Waiting for a transaction can outlive a binding or permission change.
      await authorize(user, p.scope, 'locateDevice', tx)
      const old = await tx.get(C.watches, watchId)
      if (!stop && old && old.stopped) fail('WATCH_ENDED', '此位置订阅已结束，请新建订阅')
      await tx.put(C.watches, watchId, { ...value, stopped: !!stop })
    })
    // Vendor must honor expiresAt even if the app crashes or the stop request is lost.
    if (stop) await provider.stopWatch(value)
    else {
      await provider.startWatch(value)
      const latest = await repo.get(C.watches, watchId)
      if (latest && latest.stopped) await provider.stopWatch(latest)
    }
    return { id: watchId, expiresAt: value.expiresAt, pollMs: config.pollMs }
  }
  async function refresh(user, p) {
    const b = await authorize(user, p.scope, 'locateDevice'), d = await device(b)
    if (!d.online) fail('DEVICE_OFFLINE', '设备离线，请稍后重试')
    if (!d.capabilities.location) fail('UNSUPPORTED', '设备尚不支持定位')
    await authorize(user, p.scope, 'locateDevice')
    id(p.requestId, '请求 ID')
    const opId = key(user.openid, scopeOf(b), 'location', p.requestId)
    let created = false
    const op = await repo.transaction(async tx => {
      created = false // CloudBase may retry the transaction callback.
      await authorize(user, p.scope, 'locateDevice', tx)
      const old = await tx.get(C.operations, opId)
      if (old) return old
      const last = await tx.get(C.locations, b.deviceId)
      const value = { ...scopeOf(b), id: opId, openid: user.openid, kind: 'location-refresh', state: 'submitted', version: 0,
        createdAt: now(), expiresAt: now() + config.refreshTimeoutMs, previousFixId: last && last.fixId || null }
      await tx.put(C.operations, opId, value); created = true; return value
    })
    if (created) {
      try {
        const result = await provider.refreshLocation({ ...scopeOf(b), commandId: op.id, expiresAt: op.expiresAt })
        if (result && result.refreshMode === 'wait-next-report') await updateOperation(op.id, { refreshMode: 'wait-next-report' })
      }
      catch (e) { await updateOperation(op.id, { state: 'timeout', errorCode: 'SUBMISSION_UNCONFIRMED' }) }
    }
    return getOperation(user, { scope: p.scope, operationId: op.id })
  }
  async function updateOperation(opId, patch) {
    return repo.transaction(async tx => { const op = await tx.get(C.operations, opId); if (!op) return null
      if (['success', 'failed', 'cancelled'].includes(op.state)) return op
      Object.assign(op, patch); await tx.put(C.operations, opId, op); return op })
  }
  async function getOperation(user, p) {
    await authorize(user, p.scope, 'locateDevice')
    const op = await repo.get(C.operations, id(p.operationId))
    if (!op || op.openid !== user.openid || !sameScope(op, p.scope)) fail('NOT_FOUND', '任务不存在或无权查看')
    if (!['success', 'failed', 'cancelled'].includes(op.state)) {
      const raw = await provider.getOperation(op)
      if (raw) {
        if (raw.commandId !== op.id || raw.deviceId !== op.deviceId || raw.bindingVersion !== op.bindingVersion) fail('INVALID_RESPONSE', '设备指令查询结果不匹配')
        await deviceEvent(raw)
      }
      else if (now() >= op.expiresAt) await updateOperation(op.id, { state: 'timeout' })
    }
    await authorize(user, p.scope, 'locateDevice')
    const final = await repo.get(C.operations, op.id)
    const { openid, previousFixId, ...safe } = final
    return safe
  }
  async function prepareCall(user, p) {
    const b = await authorize(user, p.scope, 'callDevice'), d = await device(b)
    if (!['voice', 'video'].includes(p.mediaType)) fail('INVALID_ARGUMENT', '请选择语音或视频')
    if (!d.online) fail('DEVICE_OFFLINE', '设备离线，暂不能呼叫')
    if (!d.capabilities[p.mediaType]) fail('UNSUPPORTED', '设备尚未提供此通话能力')
    const media = b.media || {}
    if (!['linux-direct', 'cloud-device'].includes(media.route) || !media.sn || !media.modelId || media.approved !== true) fail('MEDIA_NOT_CONFIGURED', '设备型号、通话线路或微信许可尚未就绪')
    const profile = provider.authorizeCall ? await provider.authorizeCall(user, b, p) : {}
    await authorize(user, p.scope, 'callDevice')
    id(p.requestId)
    const callId = key(user.openid, scopeOf(b), 'call', p.requestId)
    const call = await repo.transaction(async tx => {
      await authorize(user, p.scope, 'callDevice', tx)
      const existing = await tx.get(C.calls, callId)
      if (existing) { if (existing.mediaType !== p.mediaType) fail('REQUEST_CONFLICT', '相同请求编号不能改变通话类型'); return existing }
      const lock = await tx.get(C.locks, b.deviceId)
      if (lock && lock.expiresAt > now()) fail('DEVICE_BUSY', '设备已有通话，请先结束或查询原通话')
      if (d.callBusy) fail('DEVICE_BUSY', '设备正在其他通话中')
      const value = { ...scopeOf(b), id: callId, callId, openid: user.openid, mediaType: p.mediaType, state: 'preparing', version: 0, route: media.route,
        roomId: null, createdAt: now(), expiresAt: now() + config.callInviteTimeoutMs, hardExpiresAt: now() + config.maxCallMs,
        acceptedAt: null, connectedAt: null, endedAt: null, endReason: '', inviteSent: false, mediaConfig: { sn: media.sn, modelId: media.modelId } }
      await tx.put(C.calls, callId, value)
      await tx.put(C.locks, b.deviceId, { callId, expiresAt: value.hardExpiresAt })
      return value
    })
    // callDevice's public parameter table does not specify timeLimit's unit.
    // Do not silently reinterpret the server's millisecond lease as SDK seconds.
    return { ...publicCall(call), plugin: { ...profile, route: call.route, sn: call.mediaConfig.sn, modelId: call.mediaConfig.modelId, deviceName: profile.deviceName || b.deviceName || 'Mini',
      timeLimit: Number.isFinite(media.sdkTimeLimit) && media.sdkTimeLimit > 0 ? media.sdkTimeLimit : null } }
  }
  async function ownCall(user, p, permission = 'callDevice') {
    await authorize(user, p.scope, permission)
    const c = await repo.get(C.calls, id(p.callId))
    if (!c || c.openid !== user.openid || !sameScope(c, p.scope)) fail('NOT_FOUND', '通话不存在或无权查看')
    return c
  }
  async function mutateCall(callId, fn) {
    return repo.transaction(async tx => {
      const c = await tx.get(C.calls, callId)
      if (!c) fail('NOT_FOUND', '通话不存在')
      if (terminal(c)) return c
      await fn(c)
      await tx.put(C.calls, callId, c)
      if (terminal(c)) { const lock = await tx.get(C.locks, c.deviceId); if (lock && lock.callId === c.id) await tx.put(C.locks, c.deviceId, { callId: c.id, expiresAt: now() }) }
      return c
    })
  }
  async function attachRoom(user, p) {
    const c = await ownCall(user, p)
    roomId(p.roomId)
    let invite = false
    const updated = await mutateCall(c.id, item => {
      invite = false
      if (item.roomId && item.roomId !== p.roomId) fail('ROOM_CONFLICT', '此通话已关联其他房间')
      if (item.expiresAt <= now()) fail('CALL_EXPIRED', '呼叫准备已超时，请先结束原通话')
      item.roomId = p.roomId
      if (item.state === 'preparing') item.state = 'calling'
      if (item.route === 'linux-direct' && !item.inviteSent) { invite = true; item.inviteSent = true }
    })
    if (invite && !terminal(updated) && updated.state !== 'ending') {
      await authorize(user, p.scope, 'callDevice')
      try { await provider.inviteCall(updated) }
      catch (e) { fail('INVITE_UNCONFIRMED', '设备邀请发送结果未确认，请查询原通话或结束，不要重复拨号') }
    }
    return publicCall(updated)
  }
  async function endCall(user, p) {
    // Cleanup is allowed for the original caller even after consent/binding revocation;
    // it cannot create a new session or disclose position/media data.
    identity(user)
    const c = await repo.get(C.calls, id(p.callId))
    if (!c || c.openid !== user.openid) fail('NOT_FOUND', '通话不存在或无权结束')
    if (terminal(c)) return publicCall(c)
    await mutateCall(c.id, item => { item.state = 'ending'; item.endReason = 'parent-ended' })
    let confirmed = false
    try { confirmed = (await provider.endCall(c)).confirmed === true } catch (_) { /* Keep ending; do not report success. */ }
    const updated = await mutateCall(c.id, item => { if (confirmed) { item.state = 'ended'; item.endedAt = now() } })
    return publicCall(updated)
  }
  async function getCall(user, p) {
    const c = await ownCall(user, p)
    if (!terminal(c)) {
      if (now() >= c.hardExpiresAt) await mutateCall(c.id, item => { item.state = 'ended'; item.endReason = 'lease-expired'; item.endedAt = now() })
      else {
        if (c.state !== 'connected' && now() >= c.expiresAt) await endCall(user, p)
        const event = await provider.getCall(c)
        if (event) {
          if (event.kind !== 'call' || event.callId !== c.id || event.deviceId !== c.deviceId || event.bindingVersion !== c.bindingVersion) fail('INVALID_RESPONSE', '通话查询结果与当前会话不匹配')
          await deviceEvent(event)
        }
      }
    }
    await authorize(user, p.scope, 'callDevice')
    return publicCall(await repo.get(C.calls, c.id))
  }
  async function currentCall(user, p) {
    await authorize(user, p.scope, 'callDevice')
    const lock = await repo.get(C.locks, p.scope.deviceId)
    if (!lock) return null
    const c = await repo.get(C.calls, lock.callId)
    if (!c || c.openid !== user.openid || !sameScope(c, p.scope) || terminal(c)) return null
    return getCall(user, { ...p, callId: c.id })
  }
  async function clientEvent(user, p) {
    const c = await ownCall(user, p)
    if (p.roomId !== c.roomId) fail('ROOM_CONFLICT', '通话房间不匹配')
    if (['cancelVoip', 'rejectVoip', 'hangUpVoip', 'endVoip', 'abortVoip', 'timeout', 'busy', 'joinFailCaller'].includes(p.eventName)) return endCall(user, p)
    // startVoip / joinedRoomByCaller / calling cannot prove device-side consent/media.
    return publicCall(c)
  }
  async function deviceEvent(e) {
    policy(config)
    id(e.eventId, '事件 ID'); id(e.deviceId, '设备 ID')
    const b = await repo.get(C.bindings, e.deviceId)
    if (!b || !b.active || e.bindingVersion !== b.bindingVersion) fail('BINDING_CHANGED', '设备事件属于旧绑定')
    if (e.kind === 'invitation') {
      // Cloud-device invitation comes from the verified server callback, NOT attachRoom.
      // A provider adapter must decode WeChat's native encrypted callback before here.
      const old = await repo.get(C.calls, id(e.callId))
      if (!old || !sameScope(old, b) || old.route !== 'cloud-device') fail('NOT_FOUND', '云对云呼叫不存在')
      await authorize({ openid: old.openid, appid: config.appid }, scopeOf(old), 'callDevice')
      roomId(e.roomId)
      let invite = false
      const c = await mutateCall(old.id, item => {
        invite = false
        if (item.state === 'ending' || item.expiresAt <= now()) fail('CALL_EXPIRED', '此呼叫已结束或过期')
        if (item.roomId && item.roomId !== e.roomId) fail('ROOM_CONFLICT', '房间不匹配')
        item.roomId = e.roomId
        if (item.state === 'preparing') item.state = 'calling'
        if (!item.inviteSent) { invite = true; item.inviteSent = true }
      })
      if (invite && !terminal(c) && c.state !== 'ending') await provider.inviteCall(c)
      return { accepted: true }
    }
    if (e.kind === 'location') { await storeLocation(b, e.location); return { accepted: true } }
    if (e.kind === 'operation') {
      const op = await repo.get(C.operations, id(e.commandId))
      if (!op || !sameScope(op, b)) fail('NOT_FOUND', '指令不存在')
      if (!Number.isSafeInteger(e.version) || e.version <= op.version) return { ignored: true }
      if (['success', 'failed', 'cancelled'].includes(op.state)) return { ignored: true }
      if (!['accepted', 'executing', 'success', 'failed'].includes(e.state)) fail('INVALID_EVENT', '指令状态无效')
      if (e.state === 'success') {
        if (!e.location || e.location.fixId === op.previousFixId || e.location.measuredAt < op.createdAt) fail('OLD_FIX', '刷新尚未产生新定位')
        const d = await device(b)
        if (!location(e.location, d, config, now()).displayable) fail('INVALID_LOCATION', '新的定位结果不可显示')
        await storeLocation(b, e.location)
      }
      await repo.transaction(async tx => { const current = await tx.get(C.operations, op.id)
        if (e.version <= current.version || ['success', 'failed', 'cancelled'].includes(current.state)) return
        if (['executing', 'timeout'].includes(current.state) && e.state === 'accepted') return
        if (current.state === 'timeout' && e.state === 'executing') return
        await tx.put(C.operations, op.id, { ...current, state: e.state, version: e.version, errorCode: typeof e.errorCode === 'string' ? e.errorCode.slice(0,80) : null }) })
      return { accepted: true }
    }
    if (e.kind !== 'call') fail('INVALID_EVENT', '未知设备事件')
    const existing = await repo.get(C.calls, id(e.callId))
    if (!existing || !sameScope(existing, b)) fail('NOT_FOUND', '通话不存在')
    try {
      const actor = { openid: existing.openid, appid: config.appid }
      const currentBinding = await authorize(actor, scopeOf(existing), 'callDevice')
      if (provider.authorizeCall && e.state !== 'ended') await provider.authorizeCall(actor, currentBinding)
    }
    catch (err) {
      await endCall({ openid: existing.openid, appid: config.appid }, { callId: existing.id })
      throw err
    }
    if (e.roomId !== existing.roomId) fail('ROOM_CONFLICT', '设备回执房间不匹配')
    const states = ['calling', 'ringing', 'connecting', 'connected', 'ending', 'ended']
    if (!states.includes(e.state) || !Number.isSafeInteger(e.version)) fail('INVALID_EVENT', '通话状态无效')
    const updated = await mutateCall(existing.id, item => {
      if (e.version <= item.version) return
      if (item.state === 'ending' && e.state !== 'ended') return
      if (item.state !== 'connected' && e.state !== 'ended' && item.expiresAt <= now()) return
      if (states.indexOf(e.state) < states.indexOf(item.state)) return
      if (e.state === 'connected' && (e.childAccepted !== true || e.mediaReady !== true || (item.mediaType === 'video' && e.videoReady !== true))) fail('CONSENT_REQUIRED', '尚未确认孩子接听及双向媒体可用')
      item.version = e.version; item.state = e.state
      if (e.childAccepted === true && !item.acceptedAt) item.acceptedAt = now()
      if (e.state === 'connected' && !item.connectedAt) item.connectedAt = now()
      if (e.state === 'ended') { item.endedAt = now(); item.endReason = ['rejected', 'busy', 'no-answer', 'offline', 'failed', 'interrupted', 'device-ended', 'parent-ended'].includes(e.endReason) ? e.endReason : 'device-ended' }
    })
    return { accepted: true, state: updated.state }
  }
  const handlers = {
    'context.list': (u) => contexts(u), 'device.snapshot': (u,p) => snapshot(u,p.scope),
    'device.status': async (u,p) => { const b = await authorize(u,p.scope); const d = await device(b); await authorize(u,p.scope); return d },
    'location.watch': (u,p) => watch(u,p,false), 'location.unwatch': (u,p) => watch(u,p,true),
    'location.refresh': refresh, 'operation.get': getOperation, 'call.prepare': prepareCall,
    'call.attach': attachRoom, 'call.get': getCall, 'call.current': currentCall, 'call.end': endCall, 'call.event': clientEvent
  }
  return {
    // Trusted server composition only; not a public dispatch action.
    authorize,
    async dispatch(action, payload, user) { identity(user); if (!handlers[action]) fail('INVALID_ACTION', '不支持的设备操作'); return handlers[action](user, payload || {}) },
    deviceEvent,
    // Server-only hook. The family/consent backend must call AFTER changing the
    // authoritative grant, including device unbinding. Never exposed in dispatch.
    async reconcileAccess(openid) {
      const user = { openid, appid: config.appid }, calls = await repo.list(C.calls, { openid })
      let closing = 0
      for (const c of calls) {
        if (terminal(c)) continue
        try { await authorize(user, scopeOf(c), 'callDevice') }
        catch (_) { await endCall(user, { callId: c.id }); closing++ }
      }
      for (const w of await repo.list(C.watches, { openid })) {
        if (w.stopped || w.expiresAt <= now()) continue
        try { await authorize(user, scopeOf(w), 'locateDevice') }
        catch (_) {
          const ended = { ...w, stopped: true, expiresAt: now() }
          await repo.put(C.watches, w.id, ended)
          await provider.stopWatch(ended)
        }
      }
      return { closing }
    },
    // Run from a private scheduled worker after deployment, not from the client.
    async maintenance() {
      let removed = 0
      for (const a of await repo.list('mini_voip_authorizations', {})) {
        if (Number.isSafeInteger(a.expiresAt) && a.expiresAt <= now()) {
          await repo.transaction(async tx => {
            const current = await tx.get('mini_voip_authorizations', a._id || key('voip-auth', config.appid, a.openid, scopeOf(a)))
            if (current && current.expiresAt <= now()) await tx.remove('mini_voip_authorizations', a._id || key('voip-auth', config.appid, a.openid, scopeOf(a)))
          })
        }
      }
      for (const l of await repo.list(C.locations, {})) {
        if (l.expiresAt > now()) continue
        await repo.transaction(async tx => {
          const current = await tx.get(C.locations, l.deviceId)
          if (current && current.expiresAt <= now()) { await tx.remove(C.locations, l.deviceId); removed++ }
        })
      }
      for (const w of await repo.list(C.watches, {})) {
        if (w.expiresAt > now() || w.stopped) continue
        const ended = await repo.transaction(async tx => {
          const current = await tx.get(C.watches, w.id)
          if (!current || current.stopped || current.expiresAt > now()) return null
          const stopped = { ...current, stopped: true }
          await tx.put(C.watches, w.id, stopped)
          return stopped
        })
        // Claim expiration before upstream I/O so a concurrently renewed watch
        // cannot be stopped by an old maintenance scan.
        if (ended) await provider.stopWatch(ended)
      }
      for (const c of await repo.list(C.calls, {})) {
        if (terminal(c)) continue
        if (now() >= c.hardExpiresAt || (c.state !== 'connected' && now() >= c.expiresAt)) await endCall({ openid:c.openid, appid:config.appid }, {callId:c.id})
      }
      for (const r of await repo.list(C.receipts, {})) {
        if (r.expiresAt <= now()) await repo.remove(C.receipts, r.id)
      }
      return { removedLocations: removed }
    }
  }
}
module.exports = { createService, collections: C }
