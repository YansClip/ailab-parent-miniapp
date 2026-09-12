const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createWxMock } = require('./helpers')
const mini = path.resolve(__dirname, '../miniprogram') + path.sep
const event = (dataset) => ({ currentTarget: { dataset } })

function setup(t) {
  const original = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, wx: global.wx, Page: global.Page, getCurrentPages: global.getCurrentPages, getApp: global.getApp }
  Object.keys(require.cache).filter((key) => key.startsWith(mini)).forEach((key) => delete require.cache[key])
  createWxMock()
  let now = 1799900000000, id = 0, config
  const timers = new Map(), pages = [], routes = []
  global.setTimeout = (fn, delay = 0) => { const key = ++id; timers.set(key, { at: now + delay, fn }); return key }
  global.clearTimeout = (key) => timers.delete(key)
  const navigate = (method) => ({ url }) => routes.push({ method, url })
  Object.assign(wx, { navigateTo: navigate('navigateTo'), switchTab: navigate('switchTab'), redirectTo: navigate('redirectTo') })
  global.getCurrentPages = () => pages
  global.getApp = () => ({ globalData: { statusBarHeight: 44 } })
  global.Page = (value) => { config = value }
  const store = require('../miniprogram/services/store')
  const mock = require('../miniprogram/services/mock')
  const api = require('../miniprogram/services/api')
  store.init()
  store.setSession({ privacyAccepted: true, loggedIn: true, familyCreated: true, familyReady: true, role: '主管理员' })
  mock.__setClock(() => now)
  async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve() }
  async function advance(ms = 2500) {
    await flush()
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush()
    }
    now = target
    await flush()
  }
  async function open(route, query = {}) {
    require(path.join(mini, 'pages', route + '.js'))
    const page = Object.assign({}, config, {
      data: JSON.parse(JSON.stringify(config.data)),
      setData(patch, callback) { assert(!this.__disposed, '卸载页面不可回写'); Object.assign(this.data, patch); if (callback) callback() }
    })
    pages.push(page)
    if (page.onLoad) page.onLoad(query)
    if (page.onShow) page.onShow()
    await flush()
    return page
  }
  t.after(async () => {
    pages.forEach((page) => { if (page.onHide) page.onHide(); if (page.onUnload) page.onUnload() })
    await flush()
    timers.clear()
    mock.__setClock()
    Object.assign(global, original)
  })
  return { store, mock, api, routes, open, flush, advance }
}

test('全部动态控制器按日期分组、按类型筛选并打开来源', async (t) => {
  const h = setup(t), page = await h.open('home/feed')
  assert.equal(page.data.loading, false)
  assert(page.data.groups.length > 0)
  page.chooseFilter(event({ type: 'question' }))
  const questions = page.data.groups.flatMap((group) => group.items)
  assert(questions.length > 0)
  assert(questions.every((item) => item.type === 'question'))
  page.go(event({ url: questions[0].url }))
  assert.match(h.routes.at(-1).url, /^\/pages\/home\/footprint\?id=/)
  page.chooseFilter(event({ type: 'course-completed' }))
  assert(page.data.groups.flatMap((group) => group.items).every((item) => item.type === 'course-completed'))
  h.store.setScenario('empty')
  await page.load()
  assert.deepEqual(page.data.groups, [])
  h.store.setScenario('offline')
  await page.load()
  assert(page.data.error)
  assert.equal(page.data.loading, false)
})

test('闹钟列表控制器支持编辑入口、启停保存、离线待同步和普通成员只读', async (t) => {
  const h = setup(t), page = await h.open('guard/alarm')
  assert.equal(page.data.list.length, 2)
  page.add()
  assert.equal(h.routes.at(-1).url, '/pages/guard/alarm-edit')
  page.edit(event({ id: 'al1' }))
  assert.equal(h.routes.at(-1).url, '/pages/guard/alarm-edit?id=al1')
  page.toggle(event({ id: 'al1' }))
  await h.flush()
  assert.equal((await h.api.getAlarm('al1')).enabled, true)
  await h.advance()
  assert.equal((await h.api.getAlarm('al1')).enabled, false)
  assert.equal(page.data.list.find((alarm) => alarm.id === 'al1').enabled, false)
  h.store.setScenario('device-offline')
  page.toggle(event({ id: 'al1' }))
  await h.advance()
  assert.equal(page.data.list.find((alarm) => alarm.id === 'al1').synced, false)
  assert.match(page.data.result, /待.*同步/)
  h.store.setSession({ role: '普通成员' })
  await page.reload()
  assert.equal(page.data.canManage, false)
  const taskCount = Object.keys(h.store.getTasks()).length
  page.toggle(event({ id: 'al1' }))
  assert.equal(Object.keys(h.store.getTasks()).length, taskCount)
})

test('探索覆盖总览控制器读取同一服务口径，跳转维度并恢复加载错误', async (t) => {
  const h = setup(t), page = await h.open('growth/overview')
  assert.equal(page.data.growth.progress.total, 29)
  assert.equal(page.data.growth.dimensions.length, 6)
  page.goDim(event({ key: 'engineering' }))
  assert.equal(h.routes.at(-1).url, '/pages/growth/dimension?key=engineering')
  page.go(event({ url: '/pages/home/index' }))
  assert.equal(h.routes.at(-1).method, 'switchTab')
  h.store.setScenario('offline')
  await page.load()
  assert(page.data.error)
  h.store.setScenario('default')
  await page.load()
  assert.equal(page.data.error, '')
  assert.equal(page.data.loading, false)
})

test('维度详情控制器区分已知0与数据不足，未知维度展示错误', async (t) => {
  const h = setup(t)
  h.store.setCurrentChildId('child-xinghe')
  const page = await h.open('growth/dimension', { key: 'data' })
  assert.equal(page.data.dim.key, 'data')
  assert.equal(page.data.dim.value, 0)
  assert.equal(page.data.dim.insufficient, false)
  assert(page.data.dim.relatedLessons.every((lesson) => typeof lesson.statusText === 'string'))
  h.store.setScenario('empty')
  await page.load()
  assert.equal(page.data.dim.insufficient, true)
  assert.deepEqual(page.data.dim.evidence, [])
  page.key = 'not-a-dimension'
  await page.load()
  assert(page.data.error)
  assert.equal(page.data.loading, false)
})

test('阶段报告控制器使用p1目标，再生成后重读且只允许ready分享', async (t) => {
  const h = setup(t), page = await h.open('growth/phase')
  assert.equal(page.data.report.id, 'p1')
  assert.equal(page.data.report.status, 'ready')
  const originalVersion = page.data.report.version
  page.share()
  assert.match(h.routes.at(-1).url, /targetId=p1/)
  assert.match(h.routes.at(-1).url, /childId=child-xiaoman/)
  const count = h.routes.length
  const regenerate = page.retry()
  await h.flush()
  assert.equal(page.data.report.status, 'generating')
  page.share()
  assert.equal(h.routes.length, count)
  await h.advance()
  await regenerate
  assert.equal(page.data.report.status, 'ready')
  assert.equal(page.data.report.version, originalVersion + 1)
  assert.equal(page.data.busy, false)
  h.store.setScenario('fail')
  const failed = page.retry()
  await h.advance()
  await failed
  assert.equal(page.data.report.status, 'failed')
  h.store.setScenario('default')
  const recover = page.retry()
  await h.advance()
  await recover
  assert.equal(page.data.report.status, 'ready')
})

test('阶段报告控制器未知目标不分享、跨主体重新读取自己的内容', async (t) => {
  const h = setup(t), page = await h.open('growth/phase', { id: 'missing' })
  assert(page.data.error)
  page.share()
  assert.equal(h.routes.length, 0)
  page.rid = 'p1'
  h.store.setCurrentChildId('child-xinghe')
  await page.load()
  assert.equal(page.data.report.childId, 'child-xinghe')
  assert.equal(page.data.report.id, 'p1')
})

test('新增玩机指南步骤可展开折叠，入口继续匹配正确路由', async (t) => {
  const h = setup(t), page = await h.open('my/guide')
  assert(page.data.list.every((item) => Array.isArray(item.steps) && item.steps.length > 0))
  page.toggle(event({ id: 'g2' }))
  assert.equal(page.data.expanded, 'g2')
  page.toggle(event({ id: 'g2' }))
  assert.equal(page.data.expanded, '')
  const guide = page.data.list.find((item) => item.id === 'g2')
  page.open(event({ url: guide.url }))
  assert.deepEqual(h.routes.at(-1), { method: 'switchTab', url: '/pages/guard/index' })
})
