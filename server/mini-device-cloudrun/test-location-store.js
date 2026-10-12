// Receipt diagnostics, NOT a GNSS fix or the guardian map's location provider.
const crypto = require('node:crypto')
const { fail, id, sameScope, scopeOf } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const PATH = '/api/test-location/report'
const COLLECTION = 'mini_test_location_channels'
const TTL_MS = 30000
function pointValid(p) {
  return !!p && typeof p.longitude === 'number' && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 &&
    typeof p.latitude === 'number' && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && !(p.longitude === 0 && p.latitude === 0)
}
function settings(config) {
  if (config.testLocationEnabled !== true) return { enabled: false, tests: [], readers: [], expiresAt: 0 }
  let tests, readers
  try { tests = JSON.parse(config.testLocationTests || '[]'); readers = JSON.parse(config.testLocationReaders || '[]') }
  catch (_) { fail('CONFIG_REQUIRED', '定位测试范围配置无效') }
  const expiresAt = Date.parse(config.testLocationExpiresAt || '')
  if (!Number.isSafeInteger(expiresAt) || !Array.isArray(tests) || !tests.length || tests.length > 10 ||
      !Array.isArray(readers) || !readers.length || readers.length > 10 || readers.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v))) fail('CONFIG_REQUIRED', '请配置测试设备、明确截止时间和指定查看者')
  const seen = new Set()
  for (const row of tests) {
    if (!row || Object.keys(row).some(k => !['familyId', 'childId', 'deviceId', 'bindingVersion'].includes(k))) fail('CONFIG_REQUIRED', '测试范围只能包含绑定字段')
    for (const k of ['familyId', 'childId', 'deviceId']) id(row[k])
    if (!Number.isSafeInteger(row.bindingVersion) || row.bindingVersion < 1 || seen.has(row.deviceId)) fail('CONFIG_REQUIRED', '测试绑定版本或设备列表无效')
    seen.add(row.deviceId)
  }
  return { enabled: true, tests, readers, expiresAt }
}
function createTestLocationStore({ repo, config, authorize, now = Date.now }) {
  const cfg = settings(config)
  const ready = () => cfg.enabled && cfg.expiresAt > now()
  function enabled() { if (!ready()) fail('PROVIDER_NOT_CONFIGURED', '云端硬件定位测试未开启或测试窗口已结束') }
  function testScope(deviceId) {
    const scope = cfg.tests.find(s => s.deviceId === deviceId)
    if (!scope) fail('FORBIDDEN', '不在本次设备测试范围内')
    return scope
  }
  async function binding(tx, scope) {
    const b = await tx.get('mini_bindings', scope.deviceId)
    if (!b || !b.active || !sameScope(b, scope)) fail('BINDING_CHANGED', '测试设备绑定已改变，需重新核对测试范围')
    return b
  }
  async function ingest(report, actor) {
    enabled()
    const keys = ['version', 'purpose', 'eventId', 'deviceId', 'bindingVersion', 'observedAt', 'status', 'longitude', 'latitude', 'coordinateSystem']
    const valid = () => report && !Array.isArray(report) && Object.keys(report).every(k => keys.includes(k)) && report.version === 1 && report.purpose === 'engineer-location-test' &&
      ['received', 'offline'].includes(report.status) && Number.isSafeInteger(report.observedAt) && report.observedAt > 0 && report.observedAt <= now() + 1000 && now() - report.observedAt < TTL_MS &&
      ['UNKNOWN', 'WGS84', 'GCJ02'].includes(report.coordinateSystem) &&
      (report.status === 'received' ? pointValid(report) : report.longitude === null && report.latitude === null)
    if (!valid()) fail('INVALID_LOCATION', '测试坐标、坐标系或服务器收包时间无效；不能伪造 GPS 采集时间')
    id(report.eventId); id(report.deviceId)
    const scope = testScope(report.deviceId)
    if (scope.bindingVersion !== report.bindingVersion) fail('BINDING_CHANGED', '测试上报属于旧绑定')
    if (!actor || !(actor.deviceIds instanceof Set) || !actor.deviceIds.has(report.deviceId)) fail('FORBIDDEN', '签名凭证不能上报此测试设备')
    const hash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex')
    return repo.transaction(async tx => {
      enabled(); await binding(tx, scope)
      if (!valid()) fail('INVALID_LOCATION', '排队期间测试报文已过期')
      const old = await tx.get(COLLECTION, scope.deviceId)
      if (old && sameScope(old, scope)) {
        if (old.eventId === report.eventId) {
          if (old.payloadHash !== hash) fail('REQUEST_CONFLICT', '相同测试事件不能改变内容')
          return { accepted: true, duplicate: true, diagnosticOnly: true }
        }
        if (report.observedAt <= old.observedAt) return { accepted: false, ignored: true, reason: 'out-of-order', diagnosticOnly: true }
      }
      await tx.put(COLLECTION, scope.deviceId, { ...scopeOf(scope), diagnosticOnly: true, eventId: report.eventId, payloadHash: hash,
        observedAt: report.observedAt, storedAt: now(), status: report.status, coordinateSystem: report.coordinateSystem,
        point: report.status === 'received' ? { longitude: report.longitude, latitude: report.latitude } : null,
        expiresAt: Math.min(report.observedAt + TTL_MS, cfg.expiresAt) })
      return { accepted: true, duplicate: false, diagnosticOnly: true }
    })
  }
  async function snapshot(user, scope) {
    enabled()
    if (!user || !cfg.readers.includes(user.openid)) fail('FORBIDDEN', '本人不在本次云端定位测试名单中')
    if (!scope || !sameScope(testScope(scope.deviceId), scope)) fail('BINDING_CHANGED', '测试查询范围与配置不一致')
    return repo.transaction(async tx => {
      enabled()
      const b = await binding(tx, scope)
      await authorize(user, scope, 'viewDevice', tx)
      await authorize(user, scope, 'locateDevice', tx)
      enabled()
      const row = await tx.get(COLLECTION, scope.deviceId), time = now()
      const same = row && sameScope(row, scope)
      const status = !same ? 'waiting' : row.status === 'offline' ? 'offline' : row.expiresAt <= time ? 'stale' : 'received'
      const valid = status === 'received' && pointValid(row.point)
      if (same && !valid && row.point !== null) await tx.put(COLLECTION, scope.deviceId, { ...row, point: null, status: status === 'offline' ? 'offline' : 'stale' })
      return { ...scopeOf(scope), contract: 'ailab-test-location/v1', diagnosticOnly: true, deviceName: b.deviceName || '测试设备',
        status: valid ? 'received' : status === 'received' ? 'stale' : status, serverTime: time, windowEndsAt: cfg.expiresAt,
        receivedAt: same ? row.observedAt : null, measuredAt: null, expiresAt: valid ? row.expiresAt : null,
        coordinateSystem: same ? row.coordinateSystem : 'UNKNOWN', point: valid ? row.point : null }
    })
  }
  async function sweep() {
    for (const row of await repo.list(COLLECTION, {})) {
      if (!row.point) continue
      await repo.transaction(async tx => {
        const current = await tx.get(COLLECTION, row.deviceId), b = await tx.get('mini_bindings', row.deviceId)
        const allowed = cfg.tests.find(s => s.deviceId === row.deviceId)
        if (current && current.point && (!ready() || !allowed || !sameScope(current, allowed) || !b || !b.active || !sameScope(current, b) || current.expiresAt <= now())) {
          await tx.put(COLLECTION, row.deviceId, { ...current, point: null, status: 'stale' })
        }
      })
    }
  }
  return { ingest, snapshot, sweep, ready }
}
module.exports = { PATH, COLLECTION, TTL_MS, settings, pointValid, createTestLocationStore }
