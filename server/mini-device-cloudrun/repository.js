const { fail, id } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const COLLECTIONS = new Set(['mini_memberships', 'mini_bindings', 'mini_current_locations', 'mini_location_watches', 'mini_operations', 'mini_calls', 'mini_call_locks', 'mini_event_receipts', 'mini_voip_accounts', 'mini_voip_authorizations', 'mini_location_channels'])
function unavailableRepository() {
  const blocked = async () => fail('STORAGE_NOT_CONFIGURED', '私有数据库尚未配置，不能读取或写入真实家庭与设备')
  return { get: blocked, put: blocked, list: blocked, remove: blocked, transaction: blocked, health: async () => false, close: async () => {} }
}
function mysqlRepository(pool, { timeoutMs = 5000 } = {}) {
  const discarded = new WeakSet()
  const unavailable = () => Object.assign(new Error('私有数据库暂不可用，请核对连接和初始化步骤'), { code: 'STORAGE_UNAVAILABLE' })
  function discard(client) {
    if (discarded.has(client)) return
    discarded.add(client)
    client.destroy()
  }
  // Pool queueing, preparing a statement and transaction control are not all
  // covered by an execute() timeout. Own the connection and bound every stage.
  function deadline(work, expired, late) {
    return new Promise((resolve, reject) => {
      let finished = false
      const timer = setTimeout(() => {
        finished = true
        if (expired) expired()
        reject(unavailable())
      }, timeoutMs)
      Promise.resolve().then(work).then(value => {
        if (finished) { if (late) late(value); return }
        finished = true; clearTimeout(timer); resolve(value)
      }, error => {
        if (finished) return
        finished = true; clearTimeout(timer); reject(error)
      })
    })
  }
  const acquire = () => deadline(() => pool.getConnection(), null, client => client.release())
  const release = client => { if (!discarded.has(client)) client.release() }
  async function command(client, work) {
    if (discarded.has(client)) throw unavailable()
    try { return await deadline(work, () => discard(client)) }
    catch (_) { discard(client); throw unavailable() }
  }
  async function withConnection(work) {
    let client
    try { client = await acquire(); return await work(client) }
    catch (_) { throw unavailable() }
    finally { if (client) release(client) }
  }
  const check = (c, key) => { if (!COLLECTIONS.has(c)) fail('INVALID_ARGUMENT', '集合不可访问'); if (key !== undefined) id(key, '记录 ID') }
  const run = async (db, sql, args = []) => {
    if (db === pool) return withConnection(client => run(client, sql, args))
    try { const [rows] = await command(db, () => db.execute({ sql, timeout: timeoutMs }, args)); return rows }
    catch (_) { fail('STORAGE_UNAVAILABLE', '私有数据库暂不可用，请核对连接和初始化步骤') }
  }
  const decode = row => {
    if (!row) return null
    try { const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error()
      return { ...data, _id: row.record_id }
    } catch (_) { fail('STORAGE_UNAVAILABLE', '私有数据格式异常，请联系后台管理员') }
  }
  function wrap(db) {
    return {
      async get(c, key) { check(c, key); const rows = await run(db, 'SELECT record_id, data FROM mini_gateway_records WHERE collection_name=? AND record_id=?', [c, key]); return decode(rows[0]) },
      async put(c, key, value) {
        check(c, key)
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', '记录内容无效')
        const data = { ...value }; delete data._id
        await run(db, 'INSERT INTO mini_gateway_records (collection_name, record_id, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data)', [c, key, JSON.stringify(data)])
        return { ...data, _id: key }
      },
      async remove(c, key) { check(c, key); await run(db, 'DELETE FROM mini_gateway_records WHERE collection_name=? AND record_id=?', [c, key]) },
      async list(c, where) {
        check(c)
        if (!where || Object.getPrototypeOf(where) !== Object.prototype || Object.entries(where).some(([k, v]) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k) || !['string', 'boolean', 'number'].includes(typeof v) || typeof v === 'number' && !Number.isFinite(v))) fail('INVALID_ARGUMENT', '查询条件无效')
        const rows = await run(db, 'SELECT record_id, data FROM mini_gateway_records WHERE collection_name=? AND JSON_CONTAINS(data, ?) LIMIT 1001', [c, JSON.stringify(where)])
        if (rows.length > 1000) fail('RELATION_LIMIT', '关系数量超出本次查询限制，请联系管理员')
        return rows.map(decode)
      }
    }
  }
  // Pooled queries acquire their own disposable lease; transaction queries use
  // the transaction's existing connection, never a different pool connection.
  return { ...wrap(pool),
    async transaction(fn) {
      let client
      try {
        client = await acquire(); await command(client, () => client.beginTransaction())
        // One durable mutex for this initial small deployment, across instances.
        // It also serializes absent-row reservations (same-device call locks).
        const locks = await run(client, 'SELECT id FROM mini_gateway_mutex WHERE id=1 FOR UPDATE')
        if (locks.length !== 1) fail('STORAGE_UNAVAILABLE', '私有数据库未完成初始化')
        const value = await fn(wrap(client)); await command(client, () => client.commit()); return value
      } catch (e) {
        if (client && !discarded.has(client)) await command(client, () => client.rollback()).catch(() => {})
        if (e && ['STORAGE_UNAVAILABLE', 'INVALID_ARGUMENT', 'RELATION_LIMIT'].includes(e.code)) throw e
        // Preserve business errors, never SQL errors containing private details.
        if (e && /^[A-Z_]+$/.test(e.code || '') && !/^(ER_|E[A-Z]+$)/.test(e.code)) throw e
        fail('STORAGE_UNAVAILABLE', '数据库事务未完成，请查询原操作结果')
      } finally { if (client) release(client) }
    },
    async health() {
      try {
        return await withConnection(async client => {
          await run(client, 'SELECT record_id FROM mini_gateway_records LIMIT 0')
          const rows = await run(client, 'SELECT id FROM mini_gateway_mutex WHERE id=1')
          return rows.length === 1
        })
      } catch (_) { return false }
    }, close: () => pool.end()
  }
}
function createRepository(config) {
  if (config.storageDriver !== 'mysql') return unavailableRepository()
  const m = config.mysql
  if (!m || !m.host || !m.user || !m.password || !m.database || !Number.isInteger(m.port) || m.port < 1 || m.port > 65535 || (!m.tls && !m.privateNetworkConfirmed)) fail('CONFIG_REQUIRED', '请配置私有 MySQL；不允许未核实的明文公网连接')
  const mysql = require('mysql2/promise')
  const pool = mysql.createPool({ host: m.host, user: m.user, password: m.password, database: m.database, port: m.port,
    connectionLimit: 4, waitForConnections: true, queueLimit: 32, connectTimeout: 5000,
    ssl: m.tls ? { rejectUnauthorized: true, ...(m.ca ? { ca: m.ca } : {}) } : undefined })
  return mysqlRepository(pool)
}
module.exports = { createRepository, mysqlRepository, unavailableRepository, COLLECTIONS }
