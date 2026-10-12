const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { setTimeout: delay } = require('node:timers/promises')
const { mysqlRepository } = require('../server/mini-device-cloudrun/repository')
const { fixture } = require('./fixtures/device-integration')
const { collections: C } = require('../cloudfunctions/miniDeviceGateway/lib/service')

test('后台请求排队期间撤权或换绑：不得新增订阅、刷新任务或通话占用', async () => {
  for (const action of ['location.watch', 'location.refresh', 'call.prepare']) {
    for (const change of ['revoke', 'rebind']) {
      const f = await fixture(), transaction = f.repo.transaction.bind(f.repo)
      let changed = false
      f.repo.transaction = async callback => {
        if (!changed) {
          changed = true
          if (change === 'revoke') await f.repo.put(C.members, 'member-a', { ...f.member, consentActive: false })
          else await f.repo.put(C.bindings, f.scope.deviceId, { ...f.binding, bindingVersion: f.scope.bindingVersion + 1 })
        }
        return transaction(callback)
      }
      await assert.rejects(f.run(action, { requestId: 'audit-queued', mediaType: 'voice' }), { code: change === 'revoke' ? 'FORBIDDEN' : 'BINDING_CHANGED' }, action + ':' + change)
      for (const collection of [C.watches, C.operations, C.calls, C.locks]) assert.deepEqual(await f.repo.list(collection, {}), [], collection)
      assert.equal(f.controls.requests.length, 0)
    }
  }
})

function sqlConnection(overrides = {}) {
  const events = []
  const client = { async execute() { events.push('execute'); return [[{ id: 1 }]] },
    async beginTransaction() { events.push('begin') }, async commit() { events.push('commit') }, async rollback() { events.push('rollback') },
    release() { events.push('release') }, destroy() { events.push('destroy') }, ...overrides }
  return { client, events }
}
test('数据库等待连接有截止时间；迟到的连接释放且不继续执行旧请求', async () => {
  const f = sqlConnection()
  const repo = mysqlRepository({ async getConnection() { await delay(60); return f.client }, execute: f.client.execute }, { timeoutMs: 10 })
  await assert.rejects(repo.transaction(async () => 'late'), { code: 'STORAGE_UNAVAILABLE' })
  await delay(80)
  assert.deepEqual(f.events, ['release'])
})
test('数据库事务控制和查询超时销毁连接，不将未知事务交还连接池', async () => {
  for (const stage of ['beginTransaction', 'execute', 'commit']) {
    const f = sqlConnection({ async [stage]() { await delay(60) } })
    const repo = mysqlRepository({ async getConnection() { return f.client } }, { timeoutMs: 10 })
    await assert.rejects(repo.transaction(async () => 'ignored'), { code: 'STORAGE_UNAVAILABLE' })
    assert(f.events.includes('destroy'), stage)
    assert(!f.events.includes('release'), stage)
    assert(!f.events.includes('rollback'), stage)
  }
})
test('数据库回滚失败销毁连接；原业务拒绝仍保留', async () => {
  const f = sqlConnection({ async rollback() { throw Error('private SQL must not escape') } })
  const repo = mysqlRepository({ async getConnection() { return f.client } }, { timeoutMs: 10 })
  await assert.rejects(repo.transaction(async () => { throw { code: 'FORBIDDEN', message: '拒绝' } }), { code: 'FORBIDDEN' })
  assert(f.events.includes('destroy')); assert(!f.events.includes('release'))
})
test('普通数据库读取也对执行超时和迟到响应失效处理', async () => {
  const f = sqlConnection({ async execute() { await delay(60); return [[{ record_id: 'test', data: {} }]] } })
  const repo = mysqlRepository({ async getConnection() { return f.client }, execute: f.client.execute }, { timeoutMs: 10 })
  await assert.rejects(repo.get('mini_bindings', 'test'), { code: 'STORAGE_UNAVAILABLE' })
  assert.deepEqual(f.events, ['destroy'])
})

function syntheticPage(client) {
  let definition
  const context = { Page: value => { definition = value }, wx: {}, Date, setTimeout, clearTimeout,
    require: name => name.endsWith('synthetic-location') ? { createSyntheticClient: () => client } : require('../miniprogram/services/device/synthetic-view') }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/my/location-test'), 'utf8'), context)
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad(); page.onShow(); return page
}
test('模拟定位配对自然过期后清除旧状态，并恢复配对入口', async () => {
  let cleared = false
  const page = syntheticPage({ availability: () => '', paired: () => false, clear() { cleared = true } })
  page.data.paired = true; page.data.view = { hasPoint: true }; page.latest = { stale: true }
  await page.read()
  assert.equal(page.data.paired, false); assert.equal(page.data.view.hasPoint, false)
  assert.equal(page.latest, null); assert.equal(cleared, true)
  assert.match(page.data.error, /配对/)
  page.onUnload()
})

test('模拟定位读取期间会话到期：迟到的点位不再显示', async () => {
  let paired = true
  const page = syntheticPage({ availability: () => '', paired: () => paired, clear() { paired = false }, async state() { paired = false; return { latePoint: true } } })
  page.data.paired = true
  await page.read()
  assert.equal(page.data.paired, false); assert.equal(page.data.view.hasPoint, false)
  assert.equal(page.latest, null); assert.equal(page.reading, false)
  page.onUnload()
})

test('本机网络没有任何回调时也会超时中止，迟到配对结果不能恢复会话', async () => {
  const timers = new Map(); let next = 0, pending, aborted = false
  const context = { module: { exports: {} }, Date, Set,
    setTimeout(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id }, clearTimeout(id) { timers.delete(id) } }
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/device/synthetic-location'), 'utf8'), context)
  const client = context.module.exports.createSyntheticClient({ wxApi: {
    getAccountInfoSync: () => ({ miniProgram: { appId: 'wxc5abf3407ed4ef30', envVersion: 'develop' } }),
    getDeviceInfo: () => ({ platform: 'devtools' }), request(options) { pending = options; return { abort() { aborted = true } } }
  } })
  const pairing = client.pair('AABBCCDDEE'), rejection = assert.rejects(pairing, { code: 'LOCAL_UNREACHABLE' })
  const timer = [...timers.values()][0]; assert.equal(timer.ms, 5000); timer.fn()
  await rejection; assert.equal(aborted, true); assert.equal(timers.size, 0)
  pending.success({ statusCode: 200, data: { ok: true, data: { token: 'a'.repeat(64), expiresAt: Date.now() + 10000, contract: 'ailab-synthetic-location/v1' } } })
  assert.equal(client.paired(), false)
})

function browserScript(relativePath) {
  const nodes = new Map(), listeners = new Map(), requests = []
  const node = () => ({ content: 'test-page-token', value: '', dataset: {}, options: [{}, {}, {}], classList: { toggle() {} },
    setAttribute() {}, append() {}, replaceChildren() {}, remove() {}, style: {} })
  const document = { hidden: false, documentElement: { dataset: {} },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id) }, querySelector: node, querySelectorAll: () => [],
    createDocumentFragment: node, createElement: node, addEventListener: (key, fn) => listeners.set(key, fn) }
  const context = vm.createContext({ document, localStorage: { getItem() {} }, setInterval() {}, AbortSignal, Date,
    fetch(path, options) { return new Promise(resolve => requests.push({ path, options, resolve })) } })
  vm.runInContext(fs.readFileSync(require.resolve(relativePath), 'utf8'), context)
  return { context, document, nodes, listeners, requests, flush: async () => { for (let i = 0; i < 15; i++) await Promise.resolve() } }
}
test('旧联调台隐藏再显示后，旧状态请求不能重新恢复报文原文', async () => {
  const f = browserScript('../tools/mini-location-tcp/monitor-ui/app.js')
  f.document.hidden = true; f.listeners.get('visibilitychange')()
  f.document.hidden = false; f.listeners.get('visibilitychange')()
  f.requests[0].resolve({ ok: true, json: async () => ({ events: [], connections: [], revealUntil: 9999999999999 }) })
  await f.flush()
  assert.equal(vm.runInContext('state', f.context), null)
})
test('旧联调台离线后，切换选项不能把历史快照渲染成在线', async () => {
  const f = browserScript('../tools/mini-location-tcp/monitor-ui/app.js')
  vm.runInContext('state = { events: [], connections: [], revealUntil: 0 }; lastGood = Date.now()', f.context)
  f.requests[0].resolve({ ok: false, status: 500, json: async () => ({ error: 'test offline' }) })
  await f.flush()
  assert.equal(vm.runInContext('state', f.context), null)
  assert.equal(vm.runInContext('lastGood', f.context), 0)
})

test('旧联调台连接恢复后重新启用本机配对和临时查看入口', async () => {
  const f = browserScript('../tools/mini-location-tcp/monitor-ui/app.js')
  f.requests[0].resolve({ ok: false, status: 500, json: async () => ({ error: 'test offline' }) })
  await f.flush()
  assert.equal(f.nodes.get('pairLab').disabled, true)
  vm.runInContext('poll()', f.context)
  f.requests[1].resolve({ ok: true, json: async () => ({ now: Date.now(), events: [], connections: [], stats: { parsed: 0, rejected: 0, bytes: 0 },
    revealUntil: 0, media: { simulating: false, sessions: [], events: [] }, tunnel: { state: 'idle', active: false }, receiver: { running: false, port: 18765 }, lab: null }) })
  await f.flush()
  assert.equal(f.nodes.get('pairLab').disabled, false)
  assert.equal(f.nodes.get('reveal').disabled, false)
  assert.equal(f.nodes.get('health').textContent, '● 本机监控正常')
})
