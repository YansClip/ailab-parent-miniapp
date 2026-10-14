// Project-owned business model, NOT a WeChat wire protocol or media engine.
// Source mapping and trust boundaries: docs/WECHAT-VOIP-LOCAL-2026-10-14.md.
const DIRECTIONS = ['phone-to-device', 'device-to-phone']
const TERMINAL_EVENTS = {
  reject: 'rejected', busy: 'busy', cancel: 'cancelled', hangup: 'hangup',
  offline: 'offline', revoke: 'permission-revoked', bindingChanged: 'binding-changed',
  workerFailed: 'media-worker-failed'
}
function fail(code, message) { throw Object.assign(new Error(message), { code }) }
function checkPolicy(policy, direction) {
  if (!DIRECTIONS.includes(direction)) fail('INVALID_DIRECTION', '请选择呼叫方向')
  if (!policy || policy.bound !== true) fail('BINDING_CHANGED', '设备未绑定或绑定已改变')
  if (policy.callAllowed !== true) fail('FORBIDDEN', '当前家庭成员没有通话权限')
  if (policy.online !== true) fail('DEVICE_OFFLINE', '设备离线')
  if (direction === 'device-to-phone' && policy.incomingReminder !== 'authorized') {
    fail('REMINDER_REQUIRED', '设备呼入还需要家长开启微信通话提醒；手机主动呼出不受此项限制')
  }
}
function createCall({ id, direction, mediaType, now, inviteMs = 30000, maxMs = 300000 }) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !DIRECTIONS.includes(direction) ||
      !['voice', 'video'].includes(mediaType) || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(inviteMs) || inviteMs < 1000 || !Number.isSafeInteger(maxMs) || maxMs < inviteMs || maxMs > 3600000) {
    fail('INVALID_ARGUMENT', '通话参数无效')
  }
  return { id, direction, mediaType, state: 'preparing', version: 0, createdAt: now, updatedAt: now,
    inviteExpiresAt: now + inviteMs, hardExpiresAt: now + maxMs, reason: '', endedAt: null,
    acceptedAt: null, connectedAt: null, simulation: true, mediaVerified: false,
    captureAllowed: false, recordingAllowed: false }
}
function applyEvent(call, event, now) {
  if (!call || !event || !Number.isSafeInteger(now) || now < call.updatedAt) fail('INVALID_EVENT', '事件或时间无效')
  if (event.callId !== call.id) fail('CALL_MISMATCH', '事件不属于当前通话')
  if (call.state === 'ended') return call // Late events cannot resurrect a call.
  const receiver = call.direction === 'phone-to-device' ? 'device' : 'phone'
  const caller = receiver === 'device' ? 'phone' : 'device'
  const expired = now >= call.hardExpiresAt ? 'duration-limit' :
    call.state !== 'connected' && now >= call.inviteExpiresAt ? 'no-answer' : ''
  if (!expired) {
    if (['accept', 'reject'].includes(event.type) && event.actor !== receiver) fail('WRONG_ACTOR', '只有接听方可以接听或拒接')
    if (event.type === 'cancel' && event.actor !== caller) fail('WRONG_ACTOR', '只有主叫可以取消呼叫')
    if (event.type === 'hangup' && !['phone', 'device'].includes(event.actor)) fail('WRONG_ACTOR', '挂断需要指定通话方')
    if (['reject', 'busy', 'cancel'].includes(event.type) && !['preparing', 'ringing'].includes(call.state)) fail('INVALID_TRANSITION', '接听后请使用挂断，不再取消或拒接')
    if (event.type === 'hangup' && !['joining', 'connected'].includes(call.state)) fail('INVALID_TRANSITION', '尚未接听，请取消呼叫')
  }
  const endReason = expired || (Object.prototype.hasOwnProperty.call(TERMINAL_EVENTS, event.type) ? TERMINAL_EVENTS[event.type] : '')
  if (endReason) return { ...call, state: 'ended', reason: endReason, endedAt: now, updatedAt: now,
    version: call.version + 1, captureAllowed: false }
  if (event.type === 'tick') return call
  const transitions = { preparing: { notify: 'ringing' }, ringing: { accept: 'joining' }, joining: { joined: 'connected' } }
  if ((event.type === 'notify' && call.state === 'ringing') || (event.type === 'accept' && call.state === 'joining') || (event.type === 'joined' && call.state === 'connected')) return call
  const available = transitions[call.state]
  const next = available && Object.prototype.hasOwnProperty.call(available, event.type) && available[event.type]
  if (!next) fail('INVALID_TRANSITION', '当前通话阶段不能执行此操作')
  return { ...call, state: next, version: call.version + 1, updatedAt: now,
    acceptedAt: next === 'joining' ? now : call.acceptedAt,
    connectedAt: next === 'connected' ? now : call.connectedAt }
}
module.exports = { createCall, applyEvent, checkPolicy, DIRECTIONS }
