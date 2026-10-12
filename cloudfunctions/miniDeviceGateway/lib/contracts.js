const crypto = require('node:crypto')
function fail(code, message) { const e = new Error(message); e.code = code; throw e }
function id(value, name) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail('INVALID_ARGUMENT', (name || '标识') + '格式不正确')
  return value
}
function key(...parts) { return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex') }
function roomId(value) { if (typeof value !== 'string' || !value.length || value.length > 256 || /[\x00-\x20]/.test(value)) fail('INVALID_ARGUMENT', '房间 ID 格式不正确'); return value }
function scopeOf(binding) {
  return { familyId: binding.familyId, childId: binding.childId, deviceId: binding.deviceId, bindingVersion: binding.bindingVersion }
}
function sameScope(a, b) { return ['familyId', 'childId', 'deviceId', 'bindingVersion'].every(k => a[k] === b[k]) }
function policy(config) {
  for (const k of ['locationTtlMs', 'statusTtlMs', 'watchLeaseMs', 'pollMs', 'refreshTimeoutMs', 'callInviteTimeoutMs', 'maxCallMs']) {
    if (!Number.isSafeInteger(config[k]) || config[k] < 1000 || config[k] > 86400000) fail('CONFIG_REQUIRED', '请先确认定位和通话时效参数')
  }
  if (config.pollMs >= config.watchLeaseMs) fail('CONFIG_REQUIRED', '位置查询间隔必须小于订阅有效期')
  return config
}
// Standard WGS84 -> GCJ-02 offset, applied only to declared WGS84 within China.
function gcj02(lat, lng) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { latitude: lat, longitude: lng }
  const x = lng - 105, y = lat - 35, pi = Math.PI
  let dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x))
  let dlng = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x))
  const common = (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3
  dlat += common + (20*Math.sin(y*pi) + 40*Math.sin(y/3*pi))*2/3 + (160*Math.sin(y/12*pi) + 320*Math.sin(y*pi/30))*2/3
  dlng += common + (20*Math.sin(x*pi) + 40*Math.sin(x/3*pi))*2/3 + (150*Math.sin(x/12*pi) + 300*Math.sin(x/30*pi))*2/3
  const rad = lat / 180*pi, magic = 1 - .00669342162296594323*Math.sin(rad)**2, sqrt = Math.sqrt(magic)
  return { latitude: lat + dlat*180/((6378245*(1-.00669342162296594323))/(magic*sqrt)*pi), longitude: lng + dlng*180/(6378245/sqrt*Math.cos(rad)*pi) }
}
function location(raw, device, config, now) {
  raw = raw || {}
  const measuredAt = Number.isSafeInteger(raw.measuredAt) ? raw.measuredAt : null
  const expiresAt = measuredAt == null ? null : measuredAt + config.locationTtlMs
  let reason = null
  if (!device.online) reason = 'offline'
  else if (raw.status !== 'valid') reason = 'unavailable'
  else if (!['WGS84', 'GCJ02'].includes(raw.coordinateSystem)) reason = 'coordinate-unknown'
  else if (![raw.latitude, raw.longitude].every(Number.isFinite) || Math.abs(raw.latitude) > 90 || Math.abs(raw.longitude) > 180) reason = 'invalid'
  else if (!measuredAt || measuredAt > now + 5000) reason = 'invalid-time'
  else if (expiresAt <= now) reason = 'stale'
  const accuracyM = Number.isFinite(raw.accuracyM) && raw.accuracyM >= 0 ? raw.accuracyM : null
  return {
    fixId: typeof raw.fixId === 'string' ? raw.fixId : null, status: reason || 'valid', displayable: !reason,
    point: reason ? null : raw.coordinateSystem === 'WGS84' ? gcj02(raw.latitude, raw.longitude) : { latitude: raw.latitude, longitude: raw.longitude },
    coordinateSystem: 'GCJ02', accuracyM, source: String(raw.source || 'unknown'), measuredAt, expiresAt,
    address: reason ? null : String(raw.address || '设备当前位置'), serverTime: now
  }
}
const terminal = c => !c || c.state === 'ended'
function publicCall(c) {
  if (!c) return null
  const { openid, requestId, inviteSent, mediaConfig, ...safe } = c
  return safe
}
module.exports = { fail, id, roomId, key, scopeOf, sameScope, policy, location, terminal, publicCall, gcj02 }
