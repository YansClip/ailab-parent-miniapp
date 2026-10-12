// Explicit, user-triggered real integration preparation. No credentials in storage.
const { createDeviceTransport } = require('./transport')
function createDeviceSetup({ config, store, wxApi }) {
  const transport = createDeviceTransport({ config, wxApi })
  let generation = 0, identity = null, pending = new Map(), authorizing = null
  const error = (code, message) => ({ code, message })
  const scopeKey = s => [s.familyId, s.childId, s.deviceId, s.bindingVersion].join('|')
  const scopeOf = s => ({ familyId: s.familyId, childId: s.childId, deviceId: s.deviceId, bindingVersion: s.bindingVersion })
  const token = () => ({ generation, epoch: store.getEpoch() })
  function ensureCurrent(t) {
    if (generation !== t.generation || store.getEpoch() !== t.epoch || !store.getSession().privacyAccepted) throw error('STALE_CONTEXT', '登录或授权已改变，请重新操作')
  }
  function init() {
    if (!store.getSession().privacyAccepted) throw error('PRIVACY_REQUIRED', '请先主动登录并确认隐私规则')
    transport.init()
  }
  async function rpc(action, payload = {}) {
    init()
    const t = token()
    let timer
    try {
      const result = await Promise.race([
        transport.invoke(action, payload),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error('REQUEST_TIMEOUT', '接入请求超时，请查询或重试同步；不会显示假成功')), config.requestTimeoutMs) })
      ])
      ensureCurrent(t)
      const body = result && result.result
      if (!body || body.ok !== true) throw body && body.error || error('INVALID_RESPONSE', '接入服务响应异常')
      return body.data
    } catch (e) { if (e && e.code) throw e; throw error('NETWORK_ERROR', '无法连接测试后台，请检查环境部署与网络') }
    finally { if (timer) clearTimeout(timer) }
  }
  async function getIdentity() {
    const d = await rpc('identity.get')
    if (!d || d.appid !== config.appId || typeof d.openid !== 'string' || !d.openid || d.isDemo !== false || d.source !== transport.identitySource()) throw error('INVALID_IDENTITY', '未取得当前 AppID 下的真实微信身份')
    identity = d
    return d
  }
  function loginCode() {
    const t = token()
    return new Promise((resolve, reject) => wxApi.login({
      success(r) { try { ensureCurrent(t); if (!r || !r.code) throw error('LOGIN_CODE_MISSING', '未取得微信登录凭证'); resolve(r.code) } catch(e) { reject(e) } },
      fail() { reject(error('WECHAT_LOGIN_FAILED', '微信登录失败，请检查网络后重试')) }
    }))
  }
  async function link() { await getIdentity(); return rpc('voip.login', { code: await loginCode() }) }
  function wxState(target) {
    return new Promise(resolve => {
      if (typeof wxApi.getDeviceVoIPList !== 'function') return resolve('unknown')
      wxApi.getDeviceVoIPList({
        success(r) {
          if (!r || !Array.isArray(r.list)) return resolve('unknown')
          const item = r.list.find(x => x.sn === target.sn && (!x.modelId || x.modelId === target.modelId))
          resolve(item ? item.status === 1 ? 'authorized' : 'disabled' : 'missing')
        }, fail() { resolve('unknown') }
      })
    })
  }
  async function status(scope) {
    const t = token()
    await link()
    const server = await rpc('voip.status', { scope: scopeOf(scope) })
    const state = await wxState(server)
    ensureCurrent(t)
    return { ...server, wechatState: state, ready: server.serverAuthorized === true && state === 'authorized' }
  }
  async function sync(scope, remark) {
    const s = scopeOf(scope), a = pending.get(scopeKey(s))
    if (!a || a.expiresAt <= Date.now()) throw error('AUTH_INTENT_EXPIRED', '授权准备已过期，请重新授权或检查已有授权')
    const t = token()
    await link(); ensureCurrent(t)
    const state = await wxState(a); ensureCurrent(t)
    if (state !== 'authorized') throw error('WX_AUTH_UNCONFIRMED', state === 'disabled' ? '微信通话权限已关闭，请在小程序设置中开启' : '尚未确认微信通话权限，请检查后重试')
    const result = await rpc('voip.report', { scope: s, intentId: a.intentId, authorizationCreated: a.created, remark: remark || '' })
    ensureCurrent(t)
    pending.delete(scopeKey(s))
    return { ...result, wechatState: state, ready: result.serverAuthorized === true }
  }
  function authorize(scope, remark) {
    const s = scopeOf(scope), k = scopeKey(s)
    if (authorizing) return authorizing.key === k ? authorizing.promise : Promise.reject(error('AUTH_BUSY', '正在授权另一台设备，请稍后操作'))
    const t = token()
    const promise = (async () => {
      init()
      if (typeof wxApi.requestDeviceVoIP !== 'function') throw error('WX_VOIP_UNAVAILABLE', '当前微信不支持设备通话授权，请使用支持该能力的微信真机')
      await link(); ensureCurrent(t)
      const a = await rpc('voip.ticket', { scope: s })
      if (!a || !a.snTicket || !a.sn || !a.modelId || !a.deviceName || scopeKey(a) !== k) throw error('INVALID_RESPONSE', '授权票据与当前设备不匹配')
      const state = await wxState(a); ensureCurrent(t)
      let created = false
      if (state === 'disabled') throw error('WX_AUTH_DISABLED', '通话权限已关闭，请在微信的小程序设置中重新开启')
      if (state !== 'authorized') {
        try {
          await new Promise((resolve, reject) => wxApi.requestDeviceVoIP({ sn: a.sn, snTicket: a.snTicket, modelId: a.modelId, deviceName: a.deviceName, success: resolve, fail: reject }))
          created = true
        } catch (e) {
          if (!e || e.errCode !== 10001) throw error('WX_AUTH_DENIED', '设备通话授权未完成，您可以继续浏览或稍后重试')
        }
      }
      ensureCurrent(t)
      // No ticket persisted; only the server intent and exact name snapshot survive a sync failure.
      pending.set(k, { intentId: a.intentId, expiresAt: a.expiresAt, sn: a.sn, modelId: a.modelId, deviceName: a.deviceName, created })
      try { return await sync(s, remark) }
      catch (e) { if (e.code === 'STALE_CONTEXT') throw e; throw { ...e, message: '微信授权已操作，但后台同步未确认：' + (e.message || '请重试同步') } }
    })().finally(() => { if (authorizing && authorizing.promise === promise) authorizing = null })
    authorizing = { key: k, promise }
    return promise
  }
  return { getIdentity, link, authorize, sync, status,
    async checkConnection() {
      if ((config.transport || 'function') !== 'cloudrun') throw error('CONFIG_REQUIRED', '此连接检查用于独立云托管设备服务；云函数请使用身份检查')
      const d = await rpc('system.health')
      if (!d || d.contract !== 'ailab-mini-device/v1' || d.appid !== config.appId || d.source !== transport.identitySource() || d.isDemo !== false || typeof d.storageReady !== 'boolean') throw error('INVALID_RESPONSE', '连接到的不是 AILab 设备业务后台')
      return d
    },
    async bindings() {
      // Read the existing authorization API only. No device/provider request,
      // identity override, write action, or fallback to the local demo family.
      const rows = await rpc('context.list')
      const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
      if (!Array.isArray(rows) || rows.length > 1000) throw error('INVALID_RESPONSE', '云端设备列表格式不正确，请重新检查后台')
      const seen = new Set()
      return rows.map(row => {
        if (!row || !['familyId', 'childId', 'deviceId'].every(k => validId(row[k])) ||
          !Number.isSafeInteger(row.bindingVersion) || row.bindingVersion < 1 ||
          !row.child || row.child.id !== row.childId || typeof row.child.name !== 'string' ||
          typeof row.deviceName !== 'string' || !row.permissions || row.permissions.viewDevice !== true ||
          ['locateDevice', 'callDevice'].some(k => row.permissions[k] !== undefined && typeof row.permissions[k] !== 'boolean') || seen.has(row.deviceId)) {
          throw error('INVALID_RESPONSE', '云端设备授权信息不完整或重复，不能显示为验证成功')
        }
        seen.add(row.deviceId)
        return { ...scopeOf(row), childName: row.child.name.slice(0, 80), deviceName: row.deviceName.slice(0, 80),
          permissions: { viewDevice: true, locateDevice: row.permissions.locateDevice === true, callDevice: row.permissions.callDevice === true } }
      })
    },
    locationSnapshot: scope => rpc('device.snapshot', { scope: scopeOf(scope) }),
    readiness: () => rpc('voip.readiness'),
    targets: () => rpc('voip.targets'),
    async ensureCall(scope) {
      const d = await status(scope)
      if (!d.ready) throw error('VOIP_AUTH_REQUIRED', '请先在体验设置完成本设备的微信通话授权及后台同步')
      return d
    },
    invalidate() { generation++; identity = null; pending.clear(); authorizing = null },
    peekIdentity: () => identity
  }
}
module.exports = { createDeviceSetup }
