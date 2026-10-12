// Opt-in, ONLY a disposable local test database. Never accepts a remote host.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const mysql = require('../server/mini-device-cloudrun/node_modules/mysql2/promise')
const { mysqlRepository } = require('../server/mini-device-cloudrun/repository')
const { createService } = require('../cloudfunctions/miniDeviceGateway/lib/service')
const { fixture } = require('./fixtures/device-integration')
const { createLocationStore, createLocationProvider } = require('../server/mini-device-cloudrun/location-store')
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
