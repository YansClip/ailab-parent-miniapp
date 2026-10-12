const empty = (label = '尚未开始检查') => ({ hasPoint: false, label, longitude: '—', latitude: '—', receivedAt: '', remainingMs: 0, coordinateSystem: '—' })
function projectTestLocation(data, scope, requestedAt, now) {
  const invalid = () => { throw { code: 'INVALID_RESPONSE', message: '测试定位响应不完整，不显示旧坐标' } }
  if (!data || !scope || !['familyId', 'childId', 'deviceId', 'bindingVersion'].every(k => data[k] === scope[k]) ||
      data.contract !== 'ailab-test-location/v1' || data.diagnosticOnly !== true || data.measuredAt !== null ||
      !Number.isSafeInteger(data.serverTime) || !Number.isSafeInteger(data.windowEndsAt) || data.windowEndsAt <= data.serverTime ||
      !['UNKNOWN', 'WGS84', 'GCJ02'].includes(data.coordinateSystem) || !['waiting', 'received', 'offline', 'stale'].includes(data.status)) invalid()
  const labels = { waiting: '等待硬件上报', received: '服务器已收到坐标', offline: '接收连接已断开', stale: '收包已过期，等待新报文' }
  if (data.status !== 'received') { if (data.point !== null || data.expiresAt !== null) invalid(); return empty(labels[data.status]) }
  const p = data.point
  if (!p || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180 || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || (!p.longitude && !p.latitude) ||
      !Number.isSafeInteger(data.receivedAt) || data.receivedAt <= 0 || data.receivedAt > data.serverTime + 1000 ||
      !Number.isSafeInteger(data.expiresAt) || data.expiresAt > data.receivedAt + 30000 || data.expiresAt <= data.receivedAt || data.expiresAt > data.windowEndsAt) invalid()
  const remainingMs = Math.min(30000, data.expiresAt - data.serverTime, data.windowEndsAt - data.serverTime) - Math.max(0, now - requestedAt)
  if (remainingMs <= 0) return empty(labels.stale)
  return { hasPoint: true, label: labels.received, longitude: p.longitude.toFixed(6), latitude: p.latitude.toFixed(6),
    receivedAt: new Date(data.receivedAt).toLocaleString(), remainingMs, coordinateSystem: data.coordinateSystem === 'UNKNOWN' ? '待硬件确认（原始坐标）' : data.coordinateSystem }
}
module.exports = { empty, projectTestLocation }
