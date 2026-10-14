// Local-only backend harness. NEVER packaged, constructed by runtime.js or exposed by HTTP.
const crypto = require('node:crypto')
const { fail, sameScope, scopeOf, id } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const { createCall, applyEvent, checkPolicy } = require('../../miniprogram/services/device/official-call-machine')
function createSimulation({ simulation, authorize, now = Date.now, maxSessions = 100 }) {
  if (simulation !== true || typeof authorize !== 'function') fail('SIMULATION_ONLY', '仅允许显式本地演练')
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 1000) fail('INVALID_ARGUMENT', '演练容量无效')
  const calls = new Map(), requests = new Map()
  let queue = Promise.resolve()
  const serial = work => { const job = queue.then(work); queue = job.catch(() => {}); return job }
  const safe = row => ({ ...row.call, scope: { ...row.scope } })
  function owned(user, callId) {
    if (!user || !user.openid || !user.appid) fail('AUTH_REQUIRED', '演练身份缺失')
    const row = calls.get(id(callId))
    if (!row || row.openid !== user.openid || row.appid !== user.appid) fail('NOT_FOUND', '通话不存在或无权操作')
    return row
  }
  async function recheck(user, row) {
    try { await authorize(user, row.scope, 'callDevice') }
    catch (e) {
      if (['FORBIDDEN', 'BINDING_CHANGED'].includes(e.code)) row.call = applyEvent(row.call,
        { callId: row.call.id, type: e.code === 'FORBIDDEN' ? 'revoke' : 'bindingChanged' }, now())
      throw e
    }
  }
  function expire() {
    for (const row of calls.values()) row.call = applyEvent(row.call, { callId: row.call.id, type: 'tick' }, now())
  }
  return {
    prepare(user, scope, { requestId, direction, mediaType, online, incomingReminder }) { return serial(async () => {
      id(requestId)
      const b = await authorize(user, scope, 'callDevice')
      checkPolicy({ bound: true, callAllowed: true, online, incomingReminder }, direction)
      expire()
      const requestKey = JSON.stringify([user.appid, user.openid, scopeOf(b), requestId])
      const prior = requests.get(requestKey)
      if (prior) {
        const row = calls.get(prior)
        if (row.call.direction !== direction || row.call.mediaType !== mediaType) fail('REQUEST_CONFLICT', '重复请求不能改变通话参数')
        return safe(row)
      }
      if ([...calls.values()].some(row => row.scope.deviceId === b.deviceId && row.call.state !== 'ended')) fail('DEVICE_BUSY', '设备已有通话')
      if (calls.size >= maxSessions) fail('SIMULATION_LIMIT', '本轮演练容量已满，请重新启动演练')
      const call = createCall({ id: crypto.randomBytes(16).toString('hex'), direction, mediaType, now: now() })
      const row = { call, scope: scopeOf(b), openid: user.openid, appid: user.appid }
      calls.set(call.id, row); requests.set(requestKey, call.id)
      return safe(row)
    }) },
    event(user, callId, event) { return serial(async () => {
      const row = owned(user, callId)
      await recheck(user, row)
      if (!event || !sameScope(event.scope || {}, row.scope)) fail('BINDING_CHANGED', '事件绑定不一致')
      row.call = applyEvent(row.call, { callId, type: event.type, actor: event.actor }, now())
      return safe(row)
    }) },
    get(user, callId) { return serial(async () => { const row = owned(user, callId); await recheck(user, row); expire(); return safe(row) }) }
  }
}
module.exports = { createSimulation }
