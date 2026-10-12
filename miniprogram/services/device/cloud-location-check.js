// Explicit cloud QA only. Never turn the main demo mode into a cloud session.
const TEST_DEVICE_ID = 'qa_20261011_c8f2_device_a'
const fields = ['familyId', 'childId', 'deviceId', 'bindingVersion']
const fail = message => { throw { code: 'INVALID_RESPONSE', message } }
const result = (status, label, hint, extra = {}) => ({ status, label, hint, hasPoint: false, longitude: '—', latitude: '—', remainingMs: 0, ...extra })

function projectCloudLocation(snapshot, scope, startedAt, receivedAt) {
  if (!snapshot || fields.some(k => snapshot[k] !== scope[k]) || !Number.isSafeInteger(snapshot.serverTime) ||
      typeof snapshot.online !== 'boolean' || !snapshot.location || snapshot.location.coordinateSystem !== 'GCJ02') {
    fail('云端位置与所选设备、绑定版本或坐标系不一致，已清除旧位置')
  }
  const l = snapshot.location
  if (!snapshot.online) return result('offline', '测试设备离线', '后台尚未收到持续有效的设备状态，旧位置不保留。')
  if (!l.displayable || l.status !== 'valid') return result(l.status === 'stale' ? 'stale' : 'unavailable', '暂无有效测试位置', snapshot.locationHint || '定位上报尚未完成，或位置已失效；不会用本地示例补充。')
  if (!l.point || ![l.point.longitude, l.point.latitude].every(Number.isFinite) || Math.abs(l.point.longitude) > 180 ||
      Math.abs(l.point.latitude) > 90 || !Number.isSafeInteger(l.measuredAt) || l.measuredAt <= 0 ||
      l.measuredAt > snapshot.serverTime + 5000 || !Number.isSafeInteger(l.expiresAt)) fail('云端位置缺少有效坐标或采集时间')
  // Subtract the entire request duration conservatively; phone and server clocks may differ.
  const remainingMs = Math.min(60000, l.expiresAt - snapshot.serverTime) - Math.max(0, receivedAt - startedAt)
  if (remainingMs <= 0) return result('stale', '测试位置已过期', '本次查询收到时位置已失效，请等待下一次设备上报。')
  return result('valid', '收到云端测试位置', '仅用于虚构设备联调；此结果不能证明真实 GPS 精度或设备随身佩戴。', {
    hasPoint: true, longitude: l.point.longitude.toFixed(6), latitude: l.point.latitude.toFixed(6), remainingMs
  })
}

function createCloudLocationCheck({ setup, clock = Date.now }) {
  async function inspect() {
    const health = await setup.checkConnection()
    if (!health.storageReady) return result('storage-pending', '数据库尚未就绪', '先恢复云端后台到数据库的连接。')
    const bindings = await setup.bindings()
    // An experience member is not automatically a member of this test family.
    const target = bindings.find(row => row.deviceId === TEST_DEVICE_ID)
    if (!target) return result('unbound', '本人没有此测试设备的权限', '体验成员权限只允许打开小程序；还需后台将本人微信身份关联到虚构测试设备 A。')
    const state = { deviceName: target.deviceName, bindingVersion: target.bindingVersion, locationAuthorized: target.permissions.locateDevice === true,
      providerReady: health.locationProvider === 'push' }
    if (!state.providerReady) return result('provider-pending', '硬件定位入口尚未接通', '云端后台与数据库可用，但定位接收尚未启用。仅开启小程序开关不会接通硬件。', state)
    if (!state.locationAuthorized) return result('permission-pending', '本人尚未获准查看测试位置', '请由后台为虚构测试设备单独配置定位权限；本页面不会修改权限。', state)
    const startedAt = clock()
    const snapshot = await setup.locationSnapshot(target)
    return { ...projectCloudLocation(snapshot, target, startedAt, clock()), ...state }
  }
  return { inspect }
}
module.exports = { createCloudLocationCheck, projectCloudLocation, TEST_DEVICE_ID }
