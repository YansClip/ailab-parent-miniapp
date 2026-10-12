const crypto = require('node:crypto')
const { fail, id } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const PATH = '/api/location/report'
function credentials(value) {
  let rows
  try { rows = JSON.parse(value || '[]') } catch (_) { fail('CONFIG_REQUIRED', '定位转发凭证配置不是有效 JSON') }
  if (!Array.isArray(rows) || rows.length > 100) fail('CONFIG_REQUIRED', '定位转发凭证配置无效')
  const keys = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object') fail('CONFIG_REQUIRED', '定位转发凭证配置无效')
    id(row.keyId)
    if (keys.has(row.keyId) || typeof row.secret !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(row.secret) || !Array.isArray(row.deviceIds) || !row.deviceIds.length || row.deviceIds.length > 100) fail('CONFIG_REQUIRED', '每个转发凭证须有独立密钥及设备白名单')
    row.deviceIds.forEach(deviceId => id(deviceId))
    keys.set(row.keyId, { secret: row.secret, deviceIds: new Set(row.deviceIds) })
  }
  return keys
}
function signature(secret, timestamp, bytes, path = PATH) {
  return crypto.createHmac('sha256', secret).update('POST\n' + path + '\n' + timestamp + '\n').update(bytes).digest('hex')
}
function signHeaders(keyId, secret, bytes, now = Date.now(), path = PATH) {
  const timestamp = String(now)
  return { 'content-type': 'application/json', 'x-location-key': keyId, 'x-location-time': timestamp, 'x-location-signature': signature(secret, timestamp, bytes, path) }
}
function verify(headers, bytes, keys, now = Date.now(), path = PATH) {
  if (!keys.size) fail('AUTH_NOT_CONFIGURED', '定位转发验签尚未配置')
  const keyId = headers['x-location-key'], timestamp = headers['x-location-time'], sig = headers['x-location-signature']
  if (typeof keyId !== 'string' || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) || typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) fail('AUTH_REQUIRED', '定位转发签名缺失或格式错误')
  const key = keys.get(keyId)
  if (!key || Math.abs(now - Number(timestamp)) > 60000) fail('AUTH_REQUIRED', '定位转发凭证无效或请求已过期')
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(key.secret, timestamp, bytes, path), 'hex'))) fail('AUTH_REQUIRED', '定位转发签名不匹配')
  return { keyId, deviceIds: key.deviceIds }
}
module.exports = { PATH, credentials, signature, signHeaders, verify }
