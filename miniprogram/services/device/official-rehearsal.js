// Deliberately has no wx, network, plugin, storage or media dependency.
const { createCall, applyEvent, checkPolicy } = require('./official-call-machine')
function createRehearsal() {
  let clock = 0, sequence = 0, call = null, history = []
  let policy = { bound: true, callAllowed: true, online: true, incomingReminder: 'missing' }
  const labels = { preparing: '准备呼叫', ringing: '等待接听', joining: '已接听，等待媒体加入', connected: '模拟连接', ended: '已结束' }
  const reasons = { rejected: '对方拒接', busy: '对方忙线', cancelled: '主叫取消', hangup: '主动挂断', offline: '设备离线',
    'permission-revoked': '通话权限已撤回', 'binding-changed': '设备绑定已改变', 'media-worker-failed': '媒体程序异常',
    'no-answer': '无人接听 / 加入超时', 'duration-limit': '达到测试时长上限' }
  function record(text) { history.unshift({ id: ++sequence, text }); history = history.slice(0, 12) }
  function snapshot() { return { call: call && { ...call }, policy: { ...policy }, history: history.map(x => ({ ...x })),
    stateLabel: call ? labels[call.state] : '尚未开始', reasonLabel: call ? reasons[call.reason] || '' : '',
    receiver: call && call.direction === 'device-to-phone' ? 'phone' : 'device',
    active: !!call && call.state !== 'ended', clockSeconds: Math.floor(clock / 1000),
    realCallEnabled: false, mediaVerified: false } }
  function event(type, actor) {
    if (!call) throw Object.assign(new Error('请先发起模拟呼叫'), { code: 'CALL_MISSING' })
    const next = applyEvent(call, { callId: call.id, type, actor }, clock)
    if (next !== call) { call = next; record(labels[call.state] + (call.reason ? ' · ' + reasons[call.reason] : '')) }
    return snapshot()
  }
  return { snapshot,
    start(direction, mediaType = 'voice') {
      if (call && call.state !== 'ended') throw Object.assign(new Error('请先结束当前模拟通话'), { code: 'DEVICE_BUSY' })
      checkPolicy(policy, direction)
      call = createCall({ id: 'simulation-' + (++sequence), direction, mediaType, now: clock })
      record(direction === 'phone-to-device' ? '手机发起模拟呼叫' : '设备发起模拟呼叫')
      return snapshot()
    }, event,
    advance() { clock += 31000; return call ? event('tick') : snapshot() },
    policy(name, value) {
      if (!Object.prototype.hasOwnProperty.call(policy, name) ||
        (name === 'incomingReminder' ? !['authorized', 'missing', 'disabled', 'unknown'].includes(value) : typeof value !== 'boolean')) {
        throw Object.assign(new Error('模拟条件无效'), { code: 'INVALID_ARGUMENT' })
      }
      policy[name] = value
      if (call && call.state !== 'ended') {
        if (!policy.bound) event('bindingChanged')
        else if (!policy.callAllowed || call.direction === 'device-to-phone' && policy.incomingReminder !== 'authorized') event('revoke')
        else if (!policy.online) event('offline')
      }
      return snapshot()
    },
    reset() { call = null; history = []; clock = 0; policy = { bound: true, callAllowed: true, online: true, incomingReminder: 'missing' }; return snapshot() }
  }
}
module.exports = { createRehearsal }
