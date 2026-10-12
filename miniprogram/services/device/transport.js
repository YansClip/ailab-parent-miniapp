// Only WeChat SDK transports. Never call a public URL with a fabricated OpenID.
const error = (code, message) => ({ code, message })
function connection(config) {
  const kind = config.transport || 'function'
  if (kind === 'function') {
    if (!config.envId || !config.functionName) throw error('CONFIG_REQUIRED', '请先配置并部署设备云函数')
    return { kind, envId: config.envId, name: config.functionName, identitySource: 'wx-cloud-context' }
  }
  if (kind !== 'cloudrun') throw error('CONFIG_REQUIRED', '设备后台接入方式未配置')
  const c = config.cloudrun || {}
  if (c.enabled !== true || !c.envId || !/^[a-z][a-z0-9-]{0,62}$/.test(c.serviceName || '') || !/^\/api\/[a-z0-9/-]+$/.test(c.path || '')) {
    throw error('CONFIG_REQUIRED', '设备云托管服务尚未部署启用，请先按接入说明配置；不会调用 Django 计数模板')
  }
  if (c.serviceName === 'django-dmgd' || c.path === '/api/count') throw error('CONFIG_REQUIRED', 'Django 计数模板不是设备业务后台，请配置独立设备服务')
  return { kind, envId: c.envId, name: c.serviceName, path: c.path, identitySource: 'wx-cloudrun-gateway' }
}
function connectionKey(config) {
  const c = connection(config)
  return [c.kind, c.envId, c.name, c.path || ''].join('|')
}
function createDeviceTransport({ config, wxApi }) {
  let initialized = ''
  function init() {
    const c = connection(config), method = c.kind === 'cloudrun' ? 'callContainer' : 'callFunction'
    if (!wxApi.cloud || typeof wxApi.cloud.init !== 'function' || typeof wxApi.cloud[method] !== 'function') throw error('CLOUD_UNAVAILABLE', '当前微信不支持此云接入方式，请更新微信后重试')
    const account = wxApi.getAccountInfoSync && wxApi.getAccountInfoSync().miniProgram
    if (account && account.appId !== config.appId) throw error('APPID_MISMATCH', '当前运行的小程序 AppID 与项目配置不一致')
    const signature = connectionKey(config)
    if (initialized !== signature) {
      // A CloudRun env is passed to callContainer, NOT used as a CloudBase init env.
      wxApi.cloud.init(c.kind === 'cloudrun' ? { traceUser: false } : { env: c.envId, traceUser: false })
      initialized = signature
    }
    return c
  }
  async function invoke(action, payload = {}) {
    const c = init()
    const response = c.kind === 'cloudrun'
      ? await wxApi.cloud.callContainer({ config: { env: c.envId }, path: c.path, method: 'POST',
        header: { 'X-WX-SERVICE': c.name, 'Content-Type': 'application/json' }, data: { action, payload } })
      : await wxApi.cloud.callFunction({ name: c.name, data: { action, payload } })
    let body = response && (c.kind === 'cloudrun' ? response.data : response.result)
    if (typeof body === 'string') {
      if (body.length > 262144) throw error('INVALID_RESPONSE', '设备后台响应过大，已停止处理')
      try { body = JSON.parse(body) } catch (_) { throw error('INVALID_RESPONSE', '返回的不是设备业务数据，请检查部署服务和接口路径') }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.ok !== 'boolean') throw error('INVALID_RESPONSE', '设备后台响应格式不匹配，不能把模板响应当作成功')
    if (body.ok && !Object.prototype.hasOwnProperty.call(body, 'data')) throw error('INVALID_RESPONSE', '设备后台响应缺少业务数据')
    if (!body.ok && (!body.error || typeof body.error.code !== 'string' || typeof body.error.message !== 'string')) throw error('INVALID_RESPONSE', '设备后台错误响应格式异常')
    if (c.kind === 'cloudrun' && (!Number.isInteger(response.statusCode) || response.statusCode < 200 || response.statusCode >= 300) && body.ok) throw error('INVALID_RESPONSE', '设备后台 HTTP 请求未成功')
    return { result: body }
  }
  return { init, invoke, key: () => connectionKey(config), identitySource: () => connection(config).identitySource }
}
module.exports = { createDeviceTransport, connection, connectionKey }
