const { fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
function gatewayIdentity(headers, config) {
  // These headers are trusted ONLY behind WeChat's verified gateway. This flag
  // is a deployment attestation, NOT a signature. Public ingress MUST be closed.
  if (!config.gatewayOnlyConfirmed || !config.cloudrunEnv) fail('AUTH_NOT_CONFIGURED', '尚未核实仅微信网关可访问，身份接口暂不启用')
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const text = name => typeof h[name] === 'string' && h[name].length > 0 && h[name].length <= 128 && !/[\x00-\x20,]/.test(h[name]) ? h[name] : ''
  if (!text('x-wx-source') || text('x-wx-env') !== config.cloudrunEnv) fail('AUTH_REQUIRED', '请求缺少匹配的微信网关身份')
  // Cross-AppID resource reuse is deliberately not enabled in this first phase.
  if (h['x-wx-from-appid'] || h['x-wx-from-openid'] || text('x-wx-appid') !== config.appid || !text('x-wx-openid')) fail('AUTH_REQUIRED', '请从本小程序通过微信网关访问')
  return { appid: config.appid, openid: text('x-wx-openid'), source: 'wx-cloudrun-gateway' }
}
module.exports = { gatewayIdentity }
