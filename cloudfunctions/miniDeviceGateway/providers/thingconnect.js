const { fail, key } = require('../lib/contracts')
const { httpsJson } = require('../lib/https-json')
const ACCOUNTS = 'mini_voip_accounts'
const accountKey = (appid, openid) => key('thingconnect-account', appid, openid)

function createThingConnect({ repo, config, transport = httpsJson, now = Date.now }) {
  function configured() {
    if (config.voipProvider !== 'thingconnect') fail('PROVIDER_NOT_CONFIGURED', '尚未配置探鸽测试服务')
    for (const value of [config.thingconnectUserUrl, config.thingconnectVoipUrl]) {
      try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error() }
      catch (_) { fail('PROVIDER_NOT_CONFIGURED', '请填写探鸽已确认的 HTTPS 用户服务和通话服务地址') }
    }
  }
  async function account(user) {
    configured()
    const a = await repo.get(ACCOUNTS, accountKey(config.appid, user.openid))
    if (!a || a.active !== true || a.openid !== user.openid || a.appid !== config.appid || !a.providerUserId || typeof a.userJwt !== 'string' || !a.userJwt || !Number.isSafeInteger(a.expiresAt) || a.expiresAt <= now()) fail('PROVIDER_ACCOUNT_REQUIRED', '请由管理员关联本人探鸽测试账号并配置有效凭证')
    // The upstream login cache is per user+AppID. Sharing one JWT across parents
    // would let one parent's login overwrite another parent's OpenID.
    const others = await repo.list(ACCOUNTS, { providerUserId: a.providerUserId, appid: config.appid, active: true })
    if (others.some(x => x.openid !== user.openid)) fail('PROVIDER_ACCOUNT_CONFLICT', '同一探鸽账号不能分配给不同微信身份，请使用独立测试账号')
    return a
  }
  async function call(user, path, data, { kind = 'voip', method = 'POST' } = {}) {
    const a = await account(user)
    const body = await transport({ baseUrl: kind === 'user' ? config.thingconnectUserUrl : config.thingconnectVoipUrl,
      path, data, method, token: a.userJwt, timeoutMs: config.providerTimeoutMs })
    const success = kind === 'user' ? 200 : 0
    if (!body || body.code !== success) {
      const errors = { 401: ['PROVIDER_SESSION_EXPIRED', '探鸽测试账号凭证无效，请联系管理员'],
        40203: ['WECHAT_LINK_REQUIRED', '微信登录关联已失效，请重新同步'],
        40300: ['PROVIDER_DEVICE_FORBIDDEN', '此设备不属于已关联的探鸽账号'],
        50001: ['WX_VOIP_NOT_CONFIGURED', '探鸽服务尚未配置本小程序或微信设备型号'],
        50002: ['WX_VOIP_API_FAILED', '微信通话接口调用失败，请核对平台权限与配置'] }
      const e = errors[body && body.code] || ['PROVIDER_REJECTED', '探鸽服务未确认本次操作，请检查参数或查询结果']
      fail(...e) // Never forward upstream msg/data; it may contain credentials.
    }
    return body.data
  }
  return { configured, account, call,
    async link(user, code) {
      if (typeof code !== 'string' || !code || code.length > 256) fail('INVALID_ARGUMENT', '微信登录凭证无效')
      const d = await call(user, '/v1/voip/user/wechat-mini-login', { code, wx_app_id: config.appid })
      if (!d || d.wx_user_openid !== user.openid) fail('OPENID_MISMATCH', '探鸽返回的微信身份与本小程序身份不一致，已阻止接入')
      return { linked: true }
    },
    async devices(user) {
      const rows = await call(user, '/v1/user/device/list', undefined, { kind: 'user', method: 'GET' })
      if (!Array.isArray(rows)) fail('PROVIDER_RESPONSE_INVALID', '设备列表格式异常')
      return rows
    },
    ticket: (u, deviceId) => call(u, '/v1/voip/user/sn-ticket', { device_id: deviceId, wx_app_id: config.appid }),
    async authList(user) {
      const d = await call(user, '/v1/voip/user/auth-list?wx_app_id=' + encodeURIComponent(config.appid), undefined, { method: 'GET' })
      if (!d || !Array.isArray(d.list)) fail('PROVIDER_RESPONSE_INVALID', '通话授权列表格式异常')
      return d.list
    },
    report: (u, d) => call(u, '/v1/voip/user/report-auth', { ...d, wx_open_id: u.openid, wx_app_id: config.appid }),
    revoke: (u, deviceId) => call(u, '/v1/voip/user/delete-auth', { device_id: deviceId, wx_open_id: u.openid, wx_app_id: config.appid }),
    cancel: (u, deviceId, roomId) => call(u, '/v1/voip/user/cancel', { device_id: deviceId, ...(roomId ? { wx_room_id: roomId } : {}) })
  }
}
module.exports = { createThingConnect, accountKey, ACCOUNTS }
