// Shared by the loopback console and the independent Mini Program test page.
// Never accepts a cloud snapshot or treats a missing point as a successful fix.
;(function (root) {
  function project(state, requestedAt, now) {
    if (!state || state.contract !== 'ailab-synthetic-location/v1' || state.synthetic !== true || state.cloudConnected !== false || state.storage !== 'volatile-memory' || !state.scope || state.scope.deviceId !== 'local_sim_device_a') throw Error('这不是本机模拟定位服务的响应')
    const snap = state.snapshot, loc = snap && snap.location
    const elapsed = Math.max(0, now - requestedAt)
    const remaining = loc && Number.isFinite(loc.expiresAt) && Number.isFinite(state.serverTime) ? Math.max(0, Math.min(15000, loc.expiresAt - state.serverTime) - elapsed) : 0
    let status = 'waiting', label = '等待模拟上报', hint = '在电脑控制台点击「发送位置 A」。', tone = 'muted', point = null
    if (state.denied || !state.permissionGranted) { status = 'denied'; label = '查看权限已撤回'; hint = '本机虚构账号不可读取位置；云端权限没有改变。'; tone = 'warn' }
    else if (state.reason === 'waiting') { /* Never-present reports are not offline devices. */ }
    else if (!snap || !snap.online) { status = 'offline'; label = '模拟设备离线'; hint = '不展示上一次的位置。'; tone = 'warn' }
    else if (loc && loc.displayable === true && loc.status === 'valid' && loc.coordinateSystem === 'GCJ02' && loc.point && remaining > 0) {
      const p = loc.point
      const preset = (p.longitude === 120.0001 && p.latitude === 30.0001) || (p.longitude === 120.0004 && p.latitude === 30.0003)
      if (!preset) throw Error('收到非预设坐标，已停止展示')
      point = p; status = 'valid'; label = '模拟位置有效'; hint = '这是固定测试坐标，不是任何人的实际位置。'; tone = 'good'
    } else if (state.reason === 'no-fix') { status = 'no-fix'; label = '尚未取得位置'; hint = '已收到无定位报文；旧点已清除。' }
    else { status = 'expired'; label = '模拟位置已过期'; hint = '旧点已清除，请重新发送位置。'; tone = 'warn' }
    return { status, label, hint, tone, hasPoint: !!point, longitude: point ? point.longitude.toFixed(4) : '—', latitude: point ? point.latitude.toFixed(4) : '—',
      x: point && point.longitude === 120.0004 ? 72 : 28, y: point && point.latitude === 30.0003 ? 30 : 70,
      pointName: point ? point.longitude === 120.0004 ? 'B' : 'A' : '', remainingSeconds: point ? Math.ceil(remaining / 1000) : 0,
      permission: state.permissionGranted ? '本机允许' : '本机拒绝', online: snap ? snap.online ? '在线' : '离线' : '不可读取', bindingVersion: state.scope.bindingVersion }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { project }
  else root.SyntheticView = { project }
})(typeof window !== 'undefined' ? window : {})
