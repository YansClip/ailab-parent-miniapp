const crypto = require('node:crypto')
const { fail, id, key, sameScope, scopeOf } = require('./contracts')
const { createThingConnect } = require('../providers/thingconnect')
const AUTH = 'mini_voip_authorizations'
const INTENT_MS = 300000 // Local preparation lease, not a claim about WeChat ticket expiry.

function createVoipAccess({ repo, service, config, provider = createThingConnect({ repo, config }), now = Date.now }) {
  function identity(user) {
    if (!user || user.appid !== config.appid || typeof user.openid !== 'string' || !user.openid) fail('AUTH_REQUIRED', '请使用本小程序的有效微信身份')
  }
  async function binding(user, s) {
    const b = await service.authorize(user, s, 'callDevice')
    const m = b.media || {}
    if (m.approved !== true || m.route !== 'cloud-device' || m.sn !== b.deviceId || !m.modelId) fail('MEDIA_NOT_CONFIGURED', '测试设备需配置已核实的微信型号、SN 和探鸽云对云线路')
    return b
  }
  const authKey = (user, b) => key('voip-auth', config.appid, user.openid, scopeOf(b))
  async function ticket(user, p) {
    const b = await binding(user, p.scope)
    const d = await provider.ticket(user, b.deviceId)
    if (!d || typeof d.sn_ticket !== 'string' || !d.sn_ticket || typeof d.device_name !== 'string' || !d.device_name || [...d.device_name].length > 13) fail('PROVIDER_RESPONSE_INVALID', '授权票据或设备名称无效，请检查设备名称')
    await binding(user, p.scope)
    const intentId = crypto.randomBytes(16).toString('hex'), expiresAt = now() + INTENT_MS
    await repo.put(AUTH, authKey(user, b), { ...scopeOf(b), openid: user.openid, appid: config.appid,
      intentId, expiresAt, state: 'pending', deviceName: d.device_name, modelId: b.media.modelId, updatedAt: now() })
    return { ...scopeOf(b), intentId, expiresAt, sn: b.media.sn, modelId: b.media.modelId, deviceName: d.device_name, snTicket: d.sn_ticket }
  }
  async function report(user, p) {
    const b = await binding(user, p.scope), k = authKey(user, b), a = await repo.get(AUTH, k)
    id(p.intentId, '授权请求编号')
    if (!a || !sameScope(a, b) || a.intentId !== p.intentId || a.expiresAt <= now()) fail('AUTH_INTENT_EXPIRED', '授权准备已过期或被替换，请重新检查授权')
    if (typeof p.authorizationCreated !== 'boolean') fail('INVALID_ARGUMENT', '授权状态无效')
    const remark = typeof p.remark === 'string' ? p.remark.trim() : ''
    if ([...remark].length > 64) fail('INVALID_ARGUMENT', '联系人名称不能超过 64 字')
    await provider.report(user, { device_id: b.deviceId, wx_model_id: a.modelId,
      device_name: a.deviceName, authorization_created: p.authorizationCreated, ...(remark ? { remark } : {}) })
    try { await binding(user, p.scope) }
    catch (e) { await provider.revoke(user, b.deviceId).catch(() => {}); throw e }
    const rows = await provider.authList(user), match = rows.find(x => x.device_id === b.deviceId && x.auth_status === 'active')
    if (!match) fail('AUTH_SYNC_UNCONFIRMED', '微信授权已操作，服务端结果尚未确认，请重新查询或同步')
    await binding(user, p.scope)
    await repo.transaction(async tx => {
      const current = await tx.get(AUTH, k)
      if (!current || current.intentId !== a.intentId) fail('AUTH_INTENT_EXPIRED', '授权请求已被替换，请重新查询')
      await tx.put(AUTH, k, { ...current, state: 'synced', updatedAt: now() })
    })
    return { serverAuthorized: true, deviceName: match.authorized_device_name || a.deviceName }
  }
  async function status(user, p) {
    const b = await binding(user, p.scope), rows = await provider.authList(user)
    await binding(user, p.scope)
    const match = rows.find(x => x.device_id === b.deviceId && x.auth_status === 'active')
    return { serverAuthorized: !!match, deviceName: match && match.authorized_device_name || '', sn: b.media.sn, modelId: b.media.modelId }
  }
  return {
    handles: action => ['identity.get', 'voip.readiness', 'voip.login', 'voip.targets', 'voip.ticket', 'voip.report', 'voip.status', 'voip.revoke'].includes(action),
    async dispatch(action, p = {}, user) {
      identity(user)
      if (action === 'identity.get') return { appid: user.appid, openid: user.openid, source: user.source || 'wx-cloud-context', isDemo: false }
      if (action === 'voip.readiness') {
        let endpointsConfigured = false
        try { provider.configured(); endpointsConfigured = true } catch (_) { /* No secret/error detail. */ }
        let accountConfigured = false
        try { await provider.account(user); accountConfigured = true } catch (_) { /* Do not expose another account. */ }
        const targets = await service.dispatch('context.list', {}, user)
        return { endpointsConfigured, accountConfigured, targetCount: targets.length,
          platformPermission: 'unverified', mediaVerified: false, callbackOwner: 'thingconnect-voip-server' }
      }
      if (action === 'voip.login') return provider.link(user, p.code)
      if (action === 'voip.targets') {
        const contexts = await service.dispatch('context.list', {}, user)
        const rows = await provider.devices(user)
        const allowed = await service.dispatch('context.list', {}, user)
        const out = []
        for (const ctx of contexts.filter(x => allowed.some(a => sameScope(a, x)))) {
          const b = await repo.get('mini_bindings', ctx.deviceId), d = rows.find(x => x.device_id === ctx.deviceId && x.status === 1)
          if (!d || !b || !ctx.permissions.callDevice) continue
          const profile = d.profiles && d.profiles.voip || {}
          out.push({ ...scopeOf(b), child: ctx.child, deviceName: d.device_name || d.device_id, online: d.online === true,
            configured: !!(b.media && b.media.approved && b.media.route === 'cloud-device' && b.media.sn === b.deviceId && b.media.modelId),
            audioVerified: !!(b.media && b.media.audioVerified === true),
            videoVerified: !!(b.media && b.media.videoVerified === true),
            hasCamera: profile.has_camera === true, hasScreen: profile.has_screen === true,
            codecs: { upVideo: profile.up_video_mt || 'unknown', downVideo: profile.down_video_mt || 'unknown', downAudio: profile.down_audio_mt || 'unknown' } })
        }
        return out
      }
      if (action === 'voip.ticket') return ticket(user, p)
      if (action === 'voip.report') return report(user, p)
      if (action === 'voip.status') return status(user, p)
      if (action === 'voip.revoke') {
        const b = await binding(user, p.scope)
        await provider.revoke(user, b.deviceId)
        await repo.put(AUTH, authKey(user, b), { ...scopeOf(b), openid: user.openid, appid: user.appid, state: 'revoked', updatedAt: now() })
        const calls = await repo.list('mini_calls', { openid: user.openid })
        for (const c of calls.filter(x => sameScope(x, b) && x.state !== 'ended')) await service.dispatch('call.end', { callId: c.id }, user)
        return { serverAuthorized: false, wechatPermissionRemoved: false }
      }
      fail('INVALID_ACTION', '不支持的接入准备操作')
    }
  }
}
module.exports = { createVoipAccess, AUTH }
