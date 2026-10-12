// Opt-in test for a disposable, loopback-only MySQL. Never reads cloud credentials.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const mysql = require('../server/mini-device-cloudrun/node_modules/mysql2/promise')
const { mysqlRepository } = require('../server/mini-device-cloudrun/repository')
const { syntheticFamilyChecks } = require('./fixtures/synthetic-family-checks')
const port = Number(process.env.TEST_MYSQL_PORT)
if (!Number.isInteger(port) || port < 1024 || port > 65535 || process.env.TEST_DISPOSABLE_MYSQL !== 'synthetic-only') {
  throw Error('必须明确指定隔离本机端口 TEST_MYSQL_PORT 和 TEST_DISPOSABLE_MYSQL=synthetic-only')
}
const options = { host: '127.0.0.1', port, database: 'ailab_gateway_test', connectionLimit: 4, connectTimeout: 5000 }
let admin, firstPool, secondPool, repo, reader
test.before(async () => {
  admin = mysql.createPool({ ...options, user: 'root', password: 'local-synthetic-test-only' })
  const [tables] = await admin.execute('SHOW TABLES')
  assert.equal(tables.length, 0, 'Requires a fresh disposable database; existing data will not be overwritten')
  for (const sql of fs.readFileSync(require.resolve('../server/mini-device-cloudrun/schema.sql'), 'utf8').split(';').filter(s => s.trim())) await admin.query(sql)
  await admin.query("CREATE USER 'qa_app'@'%' IDENTIFIED BY 'LocalSyntheticOnly-123!'")
  await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ailab_gateway_test.mini_gateway_records TO 'qa_app'@'%'")
  await admin.query("GRANT SELECT, UPDATE ON ailab_gateway_test.mini_gateway_mutex TO 'qa_app'@'%'")
  firstPool = mysql.createPool({ ...options, user: 'qa_app', password: 'LocalSyntheticOnly-123!' })
  secondPool = mysql.createPool({ ...options, user: 'qa_app', password: 'LocalSyntheticOnly-123!' })
  repo = mysqlRepository(firstPool); reader = mysqlRepository(secondPool)
})
test.after(async () => {
  await Promise.all([repo && repo.close(), reader && reader.close(), admin && admin.end()])
})
test('真实本机 MySQL：最小权限账号、读写持久化、换绑与权限撤销', async t => {
  const [[actor]] = await firstPool.query('SELECT CURRENT_USER() AS account, VERSION() AS version')
  assert.equal(actor.account, 'qa_app@%')
  t.diagnostic('Local MySQL version: ' + actor.version + '; synthetic account only, not cloud verification')
  assert.equal(await repo.health(), true)
  await syntheticFamilyChecks(t, repo, reader)
  await t.test('应用账号无全局或数据库级权限，也不能授予别人权限', async () => {
    const [grants] = await firstPool.query('SHOW GRANTS')
    const values = grants.map(row => Object.values(row)[0])
    assert.equal(values.length, 3)
    assert(values.every(v => /GRANT USAGE ON \*\.\*/.test(v) || /GRANT SELECT, (INSERT, UPDATE, DELETE|UPDATE) ON `ailab_gateway_test`\.`mini_gateway_(records|mutex)`/.test(v)))
    assert(values.every(v => !v.includes('WITH GRANT OPTION')))
    await assert.rejects(firstPool.query('SELECT User FROM mysql.user'), { code: 'ER_TABLEACCESS_DENIED_ERROR' })
  })
  await t.test('测试结束业务表为空，互斥行完整', async () => {
    const [[rows]] = await firstPool.query('SELECT COUNT(*) AS n FROM mini_gateway_records')
    assert.equal(rows.n, 0)
    assert.equal(await repo.health(), true)
  })
})
