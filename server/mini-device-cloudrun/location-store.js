const crypto = require('node:crypto')
const { fail, id, key, sameScope, scopeOf, policy, location } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const CHANNELS = 'mini_location_channels'
const BINDINGS = 'mini_bindings'
const CURRENT = 'mini_current_locations'
function normalize(report, now) {
  const allowed = ['version', 'eventId', 'deviceId', 'bindingVersion', 'observedAt', 'measuredAt', 'status', 'coordinateSystem', 'longitude', 'latitude', 'accuracyM', 'battery']
  if (!report || typeof report !== 'object' || Array.isArray(report) || Object.keys(report).some(k => !allowed.includes(k)) || report.version !== 1) fail('INVALID_LOCATION', '请使用定位上报 v1，不能提交家庭、孩子或账号身份')
  id(report.eventId); id(report.deviceId)
  if (!Number.isSafeInteger(report.bindingVersion) || report.bindingVersion < 1 || !Number.isSafeInteger(report.observedAt) || now - report.observedAt > 60000 || report.observedAt > now + 5000) fail('INVALID_LOCATION', '绑定版本或接收时间无效')
  if (!['valid', 'no-fix', 'offline'].includes(report.status)) fail('INVALID_LOCATION', '定位状态无效')
  if (report.measuredAt != null && (!Number.isSafeInteger(report.measuredAt) || report.measuredAt <= 0 || report.measuredAt > now + 5000 || report.measuredAt > report.observedAt + 5000)) fail('INVALID_LOCATION', 'GPS 采集时间无效；不能用服务器时间替代')
  if (report.battery != null && (!Number.isFinite(report.battery) || report.battery < 0 || report.battery > 100)) fail('INVALID_LOCATION', '电量无效')
  if (report.accuracyM != null && (!Number.isFinite(report.accuracyM) || report.accuracyM < 0 || report.accuracyM > 100000)) fail('INVALID_LOCATION', '定位精度无效')
  if (report.status === 'valid') {
    if (!['WGS84', 'GCJ02'].includes(report.coordinateSystem) || ![report.longitude, report.latitude].every(Number.isFinite) || Math.abs(report.longitude) > 180 || Math.abs(report.latitude) > 90 || report.longitude === 0 && report.latitude === 0) fail('INVALID_LOCATION', '经纬度或坐标系无效')
  } else if (report.longitude != null || report.latitude != null) fail('INVALID_LOCATION', '定位失败或离线报文不得携带旧坐标')
  return report
}
function createLocationStore({ repo, config, now = Date.now }) {
  async function ingest(input, actor) {
    policy(config)
    const report = normalize(input, now())
    if (!actor || !actor.deviceIds.has(report.deviceId)) fail('FORBIDDEN', '转发凭证无此设备的上报权限')
    const hash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex')
    return repo.transaction(async tx => {
      const binding = await tx.get(BINDINGS, report.deviceId)
      if (!binding || !binding.active || binding.bindingVersion !== report.bindingVersion) fail('BINDING_CHANGED', '设备尚未绑定或上报属于旧绑定')
      const old = await tx.get(CHANNELS, report.deviceId)
      const same = old && sameScope(old, binding)
      if (same && old.eventId === report.eventId) {
        if (old.payloadHash !== hash) fail('REQUEST_CONFLICT', '相同事件编号不能修改内容')
        return { accepted: true, duplicate: true, usable: !!old.position && old.position.expiresAt > now() && old.lastSeenAt + config.statusTtlMs > now() }
      }
      if (same && report.observedAt <= old.lastObservedAt) return { accepted: false, ignored: true, reason: 'out-of-order' }
      // Preserve a newer fix if a delayed GPS sample is uploaded later. Invalid/
      // offline reports have precedence: they must immediately remove old points.
      if (same && report.status === 'valid' && old.position && report.measuredAt != null && report.measuredAt <= old.position.measuredAt) {
        await tx.put(CHANNELS, report.deviceId, { ...old, eventId: report.eventId, payloadHash: hash, lastObservedAt: report.observedAt })
        return { accepted: false, ignored: true, reason: 'old-fix' }
      }
      const reason = report.status !== 'valid' ? report.status : report.measuredAt == null ? 'capture-time-missing' : report.measuredAt + config.locationTtlMs <= now() ? 'stale' : null
      const position = reason ? null : { ...scopeOf(binding), fixId: key(actor.keyId, report.eventId), pushRecord: true, status: 'valid', measuredAt: report.measuredAt,
        longitude: report.longitude, latitude: report.latitude, coordinateSystem: report.coordinateSystem, accuracyM: report.accuracyM == null ? null : report.accuracyM,
        source: 'GNSS', address: null, expiresAt: report.measuredAt + config.locationTtlMs }
      // One current document/device, not a trajectory. No coordinates in receipts.
      await tx.put(CHANNELS, report.deviceId, { ...scopeOf(binding), eventId: report.eventId, payloadHash: hash,
        lastObservedAt: report.observedAt, lastSeenAt: report.observedAt, online: report.status !== 'offline', battery: report.battery == null ? null : report.battery, reason, position })
      await tx.remove(CURRENT, report.deviceId)
      return { accepted: true, duplicate: false, usable: !!position && report.observedAt + config.statusTtlMs > now(), reason }
    })
  }
  async function channel(scope) {
    const value = await repo.get(CHANNELS, scope.deviceId)
    return value && sameScope(value, scope) ? value : null
  }
  async function sweep() {
    policy(config)
    for (const row of await repo.list(CHANNELS, {})) {
      if (!row.position) continue
      await repo.transaction(async tx => {
        const current = await tx.get(CHANNELS, row.deviceId)
        const binding = await tx.get(BINDINGS, row.deviceId)
        if (current && current.position && (!binding || !binding.active || !sameScope(current, binding) || current.position.expiresAt <= now() || current.lastSeenAt + config.statusTtlMs <= now())) {
          await tx.put(CHANNELS, row.deviceId, { ...current, position: null, reason: 'stale' })
          const saved = await tx.get(CURRENT, row.deviceId)
          if (saved && sameScope(saved, current)) await tx.remove(CURRENT, row.deviceId)
        }
      })
    }
  }
  return { ingest, channel, sweep }
}
function createLocationProvider({ store, config, now = Date.now, fallback }) {
  const provider = {
    async getDevice(scope) {
      const row = await store.channel(scope)
      return { ...scope, stateTime: row && row.lastSeenAt || null, online: !!row && row.online && row.lastSeenAt + config.statusTtlMs > now(),
        battery: row && row.battery != null ? row.battery : null, capabilities: { location: true, voice: false, video: false },
        refreshMode: 'wait-next-report', locationHint: row && row.reason === 'capture-time-missing' ? '设备报文缺少 GPS 采集时间，暂不能确认位置是否有效。' : row && row.reason === 'no-fix' ? '设备暂未取得有效定位，请到开阔处后重试。' : '' }
    },
    async getLocation(scope) {
      const row = await store.channel(scope)
      if (!row || !row.online || row.lastSeenAt + config.statusTtlMs <= now() || !row.position) return null
      return row.position
    },
    async startWatch() {}, async stopWatch() {},
    async refreshLocation() { return { refreshMode: 'wait-next-report' } },
    async getOperation(op) {
      const raw = await provider.getLocation(op)
      if (!raw || raw.fixId === op.previousFixId || raw.measuredAt <= op.createdAt || !location(raw, { online: true }, config, now()).displayable) return null
      return { eventId: key(op.id, raw.fixId), kind: 'operation', deviceId: op.deviceId, bindingVersion: op.bindingVersion, commandId: op.id, version: op.version + 1, state: 'success', location: raw }
    }
  }
  // Never enable existing mock media as a side effect of location integration.
  return { ...fallback, ...provider }
}
module.exports = { createLocationStore, createLocationProvider, normalize, CHANNELS }
