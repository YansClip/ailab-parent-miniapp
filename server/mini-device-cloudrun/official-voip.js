const { fail, scopeOf } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
// Read-only preparation. No new database collections, provider calls or permission grants.
function createOfficialVoip({ service }) {
  const handles = action => ['official.voip.readiness', 'official.voip.targets', 'official.voip.outbound'].includes(action)
  async function target(user, scope) {
    const binding = await service.authorize(user, scope, 'callDevice')
    const media = binding.officialVoip || {}
    const configured = media.route === 'wechat-rtos-cloud' && typeof media.sn === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(media.sn) &&
      typeof media.modelId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(media.modelId)
    return { ...scopeOf(binding), deviceName: String(binding.deviceName || 'Mini').slice(0, 80),
      modelConfigured: configured, businessCallAllowed: true, incomingReminder: 'unknown',
      platformPermission: 'unverified', liveCallEnabled: false, mediaVerified: false }
  }
  return { handles, async dispatch(action, p = {}, user) {
    if (action === 'official.voip.readiness') return { provider: 'wechat-official', route: 'wechat-rtos-cloud',
      liveCallEnabled: false, mediaVerified: false, callbackVerified: false, nativeSdkLoaded: false,
      platformPermission: 'unverified', incomingReminder: 'client-check-required', recording: false }
    if (action === 'official.voip.targets') {
      const contexts = await service.dispatch('context.list', {}, user), rows = []
      for (const s of contexts.filter(x => x.permissions.callDevice === true)) {
        try { rows.push(await target(user, s)) }
        catch (e) { if (!['FORBIDDEN', 'BINDING_CHANGED'].includes(e.code)) throw e }
      }
      return rows
    }
    if (action === 'official.voip.outbound') {
      await target(user, p.scope)
      // Never use a client flag or a simulation result to enable a real call.
      fail('OFFICIAL_VOIP_NOT_READY', '官方通话尚未完成平台、可信回调和媒体服务验证，暂不发起真实呼叫')
    }
    fail('INVALID_ACTION', '不支持的官方通话操作')
  } }
}
module.exports = { createOfficialVoip }
