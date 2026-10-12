// Opt-in, ONLY a disposable local test database. Never accepts a remote host.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const mysql = require('../server/mini-device-cloudrun/node_modules/mysql2/promise')
const { mysqlRepository } = require('../server/mini-device-cloudrun/repository')
const { createService } = require('../cloudfunctions/miniDeviceGateway/lib/service')
const { fixture } = require('./fixtures/device-integration')
const { createLocationStore, createLocationProvider } = require('../server/mini-device-cloudrun/location-store')
const { createTestLocationStore, COLLECTION: TEST_LOCATION_COLLECTION } = require('../server/mini-device-cloudrun/test-location-store')
const port = Number(process.env.TEST_MYSQL_PORT)
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.env.TEST_DISPOSABLE_MYSQL !== 'synthetic-only') throw Error('需要隔离本机端口 TEST_MYSQL_PORT 和 TEST_DISPOSABLE_MYSQL=synthetic-only；禁止连接现有业务库')
const options = { host: '127.0.0.1', port, user: 'root', password: 'local-synthetic-test-only', database: 'ailab_gateway_test', connectionLimit: 4 }
let pool, repo, second
test.before(async () => {
  pool = mysql.createPool(options); repo = mysqlRepository(pool); second = mysqlRepository(mysql.createPool(options))
  const schema = fs.readFileSync(require.resolve('../server/mini-device-cloudrun/schema.sql'), 'utf8')
  for (const sql of schema.split(';').filter(s => s.trim())) await pool.execute(sql)
})
test.after(async () => { if (repo) await repo.close(); if (second) await second.close() })
test('真实 MySQL：表初始化、JSON 条件、CRUD 和跨连接持久化', async () => {
  assert.equal(await repo.health(), true)
  await repo.put('mini_memberships', 'sql-test-member', { openid: 'sql-test-parent', active: true, consentActive: false, childIds: ['a', 'b'] })
  assert.deepEqual((await second.get('mini_memberships', 'sql-test-member')).childIds, ['a', 'b'])
  assert.equal((await repo.list('mini_memberships', { active: true, openid: 'sql-test-parent' })).length, 1)
  assert.equal((await repo.list('mini_memberships', { consentActive: true, openid: 'sql-test-parent' })).length, 0)
  await repo.remove('mini_memberships', 'sql-test-member'); assert.equal(await repo.get('mini_memberships', 'sql-test-member'), null)
})
test('真实 MySQL：异常事务完全回滚，第二个连接不会读到未提交权限', async () => {
  await assert.rejects(repo.transaction(async tx => { await tx.put('mini_bindings', 'rollback-device', { active: true }); throw { code: 'FORBIDDEN', message: '测试拒绝' } }), { code: 'FORBIDDEN' })
  assert.equal(await second.get('mini_bindings', 'rollback-device'), null)
})
test('真实 MySQL：两个实例并发更新不丢数据，缺行预留受互斥保护', async () => {
  await repo.put('mini_operations', 'sql-counter', { value: 0 })
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? repo : second).transaction(async tx => {
    const before = await tx.get('mini_operations', 'sql-counter')
    await new Promise(resolve => setImmediate(resolve)); await tx.put('mini_operations', 'sql-counter', { value: before.value + 1 })
  })))
  assert.equal((await repo.get('mini_operations', 'sql-counter')).value, 20)
})
test('真实 MySQL + 业务核心：跨家庭拒绝，同设备并发呼叫只建一个有效会话', async () => {
  const f = await fixture()
  for (const [key, data] of f.repo.dump()) { const index = key.indexOf(':'); await repo.put(key.slice(0, index), key.slice(index + 1), data) }
  const a = createService({ repo, provider: f.provider, config: f.config, now: f.now }), b = createService({ repo: second, provider: f.provider, config: f.config, now: f.now })
  await assert.rejects(a.dispatch('device.snapshot', { scope: f.scope }, { ...f.user, openid: 'other-family-parent' }), { code: 'FORBIDDEN' })
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).dispatch('call.prepare', { scope: f.scope, requestId: 'parallel-' + i, mediaType: 'voice' }, f.user)))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await repo.list('mini_calls', { deviceId: f.scope.deviceId })).length, 1)
})
test('真实 MySQL 定位：跨实例重复/乱序不续命、第二实例可读有效位置、无定位及时清除', async () => {
  const f = await fixture()
  await repo.remove('mini_location_channels', f.scope.deviceId)
  await repo.remove('mini_current_locations', f.scope.deviceId)
  for (const [k, v] of f.repo.dump()) { const i = k.indexOf(':'); await repo.put(k.slice(0, i), k.slice(i + 1), v) }
  const a = createLocationStore({ repo, config: f.config, now: f.now }), b = createLocationStore({ repo: second, config: f.config, now: f.now })
  const actor = { keyId: 'sql-relay', deviceIds: new Set([f.scope.deviceId]) }
  const report = { version: 1, eventId: 'sql-location-one', deviceId: f.scope.deviceId, bindingVersion: 1, observedAt: f.now(), measuredAt: f.now(), status: 'valid', longitude: 120.0001, latitude: 30.0001, coordinateSystem: 'WGS84' }
  const results = await Promise.all([a.ingest(report, actor), b.ingest(report, actor)])
  assert.equal(results.filter(x => x.duplicate).length, 1)
  const provider = createLocationProvider({ store: b, config: f.config, now: f.now })
  const service = createService({ repo: second, provider, config: f.config, now: f.now })
  assert.equal((await service.dispatch('device.snapshot', { scope: f.scope }, f.user)).location.displayable, true)
  f.advance(1)
  await b.ingest({ ...report, eventId: 'sql-location-two', observedAt: f.now(), measuredAt: null, status: 'no-fix', longitude: null, latitude: null }, actor)
  assert.equal((await a.ingest(report, actor)).ignored, true)
  assert.equal((await service.dispatch('device.snapshot', { scope: f.scope }, f.user)).location.point, null)
  assert.equal(await repo.get('mini_current_locations', f.scope.deviceId), null)
})
test('真实 MySQL：锁等待超时后不产生迟到写入，连接池可以继续使用', async () => {
  const limited = mysqlRepository(mysql.createPool(options), { timeoutMs: 100 })
  const holder = await pool.getConnection()
  try {
    await holder.beginTransaction()
    await holder.execute('SELECT id FROM mini_gateway_mutex WHERE id=1 FOR UPDATE')
    await assert.rejects(limited.transaction(tx => tx.put('mini_bindings', 'must-not-be-written', { active: true })), { code: 'STORAGE_UNAVAILABLE' })
    await holder.rollback()
    assert.equal(await limited.get('mini_bindings', 'must-not-be-written'), null)
    assert.equal(await limited.health(), true)
    await limited.transaction(tx => tx.put('mini_operations', 'after-timeout', { recovered: true }))
    assert.equal((await limited.get('mini_operations', 'after-timeout')).recovered, true)
  } finally { await holder.rollback(); holder.release(); await limited.close() }
})
test('真实 MySQL 硬件收包诊断：任意样例坐标跨实例可读，单记录覆盖且按权限/过期清点', async () => {
  const f = await fixture()
  await repo.remove(TEST_LOCATION_COLLECTION, f.scope.deviceId)
  for (const [k, v] of f.repo.dump()) { const i = k.indexOf(':'); await repo.put(k.slice(0, i), k.slice(i + 1), v) }
  Object.assign(f.config, { testLocationEnabled: true, testLocationTests: JSON.stringify([f.scope]), testLocationReaders: JSON.stringify([f.user.openid]), testLocationExpiresAt: new Date(f.now() + 60000).toISOString() })
  const service = createService({ repo: second, provider: f.provider, config: f.config, now: f.now })
  const writer = createTestLocationStore({ repo, config: f.config, now: f.now })
  const reader = createTestLocationStore({ repo: second, config: f.config, now: f.now, authorize: service.authorize })
  const actor = { deviceIds: new Set([f.scope.deviceId]) }
  const report = { version: 1, purpose: 'engineer-location-test', eventId: 'sql-receipt-1', deviceId: f.scope.deviceId, bindingVersion: 1, observedAt: f.now(), status: 'received', longitude: 121.4567, latitude: 31.23456, coordinateSystem: 'UNKNOWN' }
  await writer.ingest(report, actor)
  assert.equal((await reader.snapshot(f.user, f.scope)).point.longitude, 121.4567)
  f.advance(1); await writer.ingest({ ...report, eventId: 'sql-receipt-2', observedAt: f.now(), longitude: 110.9876 }, actor)
  assert.equal((await reader.snapshot(f.user, f.scope)).point.longitude, 110.9876)
  assert.equal((await repo.list(TEST_LOCATION_COLLECTION, { deviceId: f.scope.deviceId })).length, 1)
  await repo.put('mini_memberships', 'member-a', { ...f.member, permissions: { viewDevice: true, locateDevice: false } })
  await assert.rejects(reader.snapshot(f.user, f.scope), { code: 'FORBIDDEN' })
  f.advance(30000); await reader.sweep()
  assert.equal((await repo.get(TEST_LOCATION_COLLECTION, f.scope.deviceId)).point, null)
})
test('隔离 MySQL 应用账号：仅 CRUD 权限可写读测试收包，不能建表', async () => {
  // This account exists ONLY in the disposable loopback container, not the cloud.
  await pool.query("CREATE USER IF NOT EXISTS 'test_receipt_app'@'%' IDENTIFIED BY 'local-receipt-fixture-only'")
  await pool.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ailab_gateway_test.* TO 'test_receipt_app'@'%'")
  const appPool = mysql.createPool({ ...options, user: 'test_receipt_app', password: 'local-receipt-fixture-only' })
  const appRepo = mysqlRepository(appPool)
  try {
    const f = await fixture()
    for (const [k, v] of f.repo.dump()) { const i = k.indexOf(':'); await repo.put(k.slice(0, i), k.slice(i + 1), v) }
    await repo.remove(TEST_LOCATION_COLLECTION, f.scope.deviceId)
    Object.assign(f.config, { testLocationEnabled: true, testLocationTests: JSON.stringify([f.scope]), testLocationReaders: JSON.stringify([f.user.openid]), testLocationExpiresAt: new Date(f.now() + 60000).toISOString() })
    const service = createService({ repo: appRepo, provider: f.provider, config: f.config, now: f.now })
    const receipts = createTestLocationStore({ repo: appRepo, config: f.config, now: f.now, authorize: service.authorize })
    await receipts.ingest({ version: 1, purpose: 'engineer-location-test', eventId: 'app-receipt', deviceId: f.scope.deviceId, bindingVersion: 1, observedAt: f.now(), status: 'received', longitude: 111.4321, latitude: 28.76543, coordinateSystem: 'UNKNOWN' }, { deviceIds: new Set([f.scope.deviceId]) })
    assert.equal((await receipts.snapshot(f.user, f.scope)).point.longitude, 111.4321)
    assert.equal(await appRepo.health(), true)
    await assert.rejects(appPool.query('CREATE TABLE denied_test_table (id INT)'), { code: 'ER_TABLEACCESS_DENIED_ERROR' })
  } finally { await appRepo.close() }
})
