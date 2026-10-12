const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { createWxMock } = require('./helpers')
const mini = path.resolve(__dirname, '../miniprogram') + path.sep

function environment(t) {
  const original = { wx: global.wx, Page: global.Page, Component: global.Component, getCurrentPages: global.getCurrentPages, getApp: global.getApp, setInterval: global.setInterval }
  Object.keys(require.cache).filter(key => key.startsWith(mini)).forEach(key => delete require.cache[key])
  createWxMock()
  const routes = [], mounted = []
  let definition, intervals = 0, logins = 0
  const record = method => options => routes.push({ method, url: options.url })
  Object.assign(wx, { navigateTo: record('navigateTo'), redirectTo: record('redirectTo'), switchTab: record('switchTab'), reLaunch: record('reLaunch'), login: () => { logins += 1 }, createCanvasContext: () => new Proxy({}, { get: () => () => {} }) })
  global.setInterval = () => { intervals += 1; throw Error('游客不应启动定位轮询') }
  global.getCurrentPages = () => mounted
  global.Page = value => { definition = value }
  const store = require('../miniprogram/services/store')
  const api = require('../miniprogram/services/api')
  const access = require('../miniprogram/services/access')
  store.init()
  function page(route, query = {}) {
    const file = path.join(mini, 'pages', route + '.js')
    delete require.cache[file]; require(file)
    const p = { ...definition, data: JSON.parse(JSON.stringify(definition.data || {})), setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() } }
    mounted.push(p)
    if (p.onLoad) p.onLoad(query)
    return p
  }
  async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve() }
  t.after(() => { mounted.forEach(p => { if (p.onUnload) p.onUnload() }); Object.assign(global, original) })
  return { store, api, access, routes, page, flush, get intervals() { return intervals }, get logins() { return logins } }
}

test('隐藏联调页在绑定前可打开，但不读取示例私有数据或自动收集身份', async t => {
  const h = environment(t)
  h.api.getContext = () => { throw Error('未绑定时不应读取私有家庭数据') }
  h.api.getRealIdentity = () => { throw Error('不能自动收集 OpenID') }
  h.api.setDemoScenario = () => { throw Error('游客不能修改示例状态') }
  h.api.resetDemo = () => { throw Error('游客不能重置数据') }
  h.api.injectDemoEvent = () => { throw Error('游客不能注入数据') }
  h.page('my/about').debug()
  assert.deepEqual(h.routes, [{ method: 'navigateTo', url: '/pages/my/debug' }])
  const p = h.page('my/debug')
  p.onShow(); await h.flush()
  assert.equal(p.data.demoReady, false)
  await p.pick({ currentTarget: { dataset: { id: 'stale' } } }); await p.inject(); await p.reset()
  assert.equal(h.logins, 0)
  assert.equal(h.store.getSession().privacyAccepted, false)
})

test('默认启动页为首页，不是欢迎、隐私或登录页；旧欢迎链接也回浏览', t => {
  const h = environment(t)
  const config = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'))
  assert.equal(config.pages[0], 'pages/home/index')
  assert.equal(config.pages.length, 48)
  h.page('auth/welcome')
  assert.deepEqual(h.routes, [{ method: 'switchTab', url: '/pages/home/index' }])
  assert.equal(h.logins, 0)
  assert.equal(h.store.getSession().privacyAccepted, false)
})

for (const route of ['home/index', 'guard/index', 'growth/index', 'my/index']) {
  test('未登录直接浏览 ' + route + '，不调用私有数据、设备、授权或轮询', async t => {
    const h = environment(t)
    for (const key of ['getHome', 'getParent', 'getChildren', 'getFamily', 'getDevices', 'getGrowth', 'getLocation', 'getGuardChildren', 'watchLocation', 'startCall']) {
      h.api[key] = () => { throw Error('游客访问了私有接口 ' + key) }
    }
    const page = h.page(route)
    page.onShow()
    await h.flush()
    assert.equal(page.data.guest, true)
    assert.equal(page.data.loading, false)
    assert.equal(page.data.signedIn, false)
    assert.equal(h.routes.length, 0)
    assert.equal(h.logins, 0)
    assert.equal(h.intervals, 0)
    assert.equal(h.store.getSession().loggedIn, false)
    assert.equal(h.store.getSession().privacyAccepted, false)
  })
}

test('退出或撤回授权后重进四入口，清除旧孩子、家庭、点位与卡片', t => {
  const h = environment(t)
  h.store.setSession({ loggedIn: false, privacyAccepted: false, familyReady: true, parentName: '私人家长姓名', familyName: '私人家庭名称' })
  for (const route of ['home/index', 'guard/index', 'growth/index', 'my/index']) {
    const p = h.page(route)
    Object.assign(p.data, { parent: { name: '私有值' }, child: { name: '私有值' }, home: { child: { name: '私有值' } }, data: { child: { name: '私有值' } }, children: [{ name: '私有值' }], groups: [{ date: '私有值' }], loc: { point: { latitude: 30, longitude: 120 } }, markers: [{ id: 1 }] })
    p.onShow()
    assert.equal(p.data.guest, true)
    if (route === 'home/index') { assert.deepEqual(p.data.parent, {}); assert.deepEqual(p.data.home.child, {}); assert.deepEqual(p.data.groups, []) }
    if (route === 'guard/index') { assert.equal(p.data.loc.point, null); assert.deepEqual(p.data.markers, []) }
    if (route === 'growth/index') assert.deepEqual(p.data.data.child, {})
    if (route === 'my/index') { assert.deepEqual(p.data.parent, {}); assert.deepEqual(p.data.family.members, []); assert.deepEqual(p.data.child, {}) }
    assert.deepEqual(p.data.children, [])
  }
  assert.equal(h.routes.length, 0)
})

test('已登录但未绑定家庭仍可浏览，不被自动强制进入绑定页', t => {
  const h = environment(t)
  h.store.setSession({ loggedIn: true, privacyAccepted: true, familyReady: false })
  const p = h.page('home/index'); p.onShow()
  assert.equal(p.data.guest, true)
  assert.equal(p.data.signedIn, true)
  assert.equal(h.routes.length, 0)
  h.access.requestLogin('home')
  assert.equal(h.routes.at(-1).url, '/pages/family/create')
})

test('公开指南、展开示例与六维说明不读取家庭，也不申请授权', async t => {
  const h = environment(t)
  h.api.getGuide = () => { throw Error('公开指南不能读取孩子绑定状态') }
  const p = h.page('my/guide'); p.onShow(); await h.flush()
  assert.equal(p.data.list.length, 5)
  assert(p.data.list.every(item => item.status === '使用说明' && item.steps.length > 0))
  global.Component = value => { global.__publicDefinition = value }
  delete require.cache[require.resolve('../miniprogram/components/public-preview/index')]
  require('../miniprogram/components/public-preview/index')
  const def = global.__publicDefinition; delete global.__publicDefinition
  const component = { ...def.methods, data: { ...def.data, section: 'home' }, setData(patch) { Object.assign(this.data, patch) } }
  assert(component.data.notes.every(item => /示例/.test(item.label) && !item.childId))
  component.toggle({ currentTarget: { dataset: { id: 'question' } } })
  assert.equal(component.data.expanded, 'question')
  component.showDimension({ currentTarget: { dataset: { id: '1' } } })
  assert.equal(component.data.dimension, '1')
  assert.equal(h.routes.length, 0)
  component.login()
  assert.equal(h.routes.at(-1).url, '/pages/auth/privacy?next=home')
  assert.equal(h.logins, 0)
})

test('拒绝隐私和暂不登录返回原浏览入口，重复进入不自动询问', async t => {
  const h = environment(t)
  const privacy = h.page('auth/privacy', { next: 'growth' }); privacy.onDecline()
  assert.deepEqual(h.routes.at(-1), { method: 'switchTab', url: '/pages/growth/index' })
  assert.equal(h.store.getSession().privacyAccepted, false)
  const login = h.page('auth/login', { next: 'guard' }); login.skip()
  assert.deepEqual(h.routes.at(-1), { method: 'switchTab', url: '/pages/guard/index' })
  const count = h.routes.length
  h.page('home/index').onShow(); await h.flush()
  assert.equal(h.routes.length, count)
  assert.equal(h.logins, 0)
  assert.equal(h.store.getSession().loggedIn, false)
})

test('跳过或卸载登录后，迟到的微信登录回调不能写入账号或跳转', async t => {
  const h = environment(t)
  h.store.setSession({ privacyAccepted: true })
  let callback
  wx.login = options => { callback = options.success }
  const p = h.page('auth/login', { next: 'my' })
  p.onLogin(); p.skip(); const count = h.routes.length
  callback({ code: 'late-code' }); await h.flush()
  assert.equal(h.store.getSession().loggedIn, false)
  assert.equal(h.routes.length, count)
  const second = h.page('auth/login')
  second.onLogin(); second.onUnload(); callback({ code: 'late-unloaded' }); await h.flush()
  assert.equal(h.store.getSession().loggedIn, false)
  assert.equal(h.routes.length, count)
})

test('正常主动登录返回选定入口；公开浏览不放松私有 API 权限', async t => {
  const h = environment(t)
  await assert.rejects(h.api.getHome(), error => error.code === 'AUTH_REQUIRED')
  await assert.rejects(h.api.getGrowth(), error => error.code === 'AUTH_REQUIRED')
  await assert.rejects(h.api.getLocation(), error => error.code === 'AUTH_REQUIRED')
  h.store.setSession({ privacyAccepted: true, familyReady: true })
  wx.login = options => options.success({ code: 'valid-code' })
  const p = h.page('auth/login', { next: 'growth' }); p.onLogin(); await h.flush()
  assert.equal(h.store.getSession().loggedIn, true)
  assert.deepEqual(h.routes.at(-1), { method: 'switchTab', url: '/pages/growth/index' })
  const growth = h.page('growth/index'); growth.onShow(); await h.flush()
  assert.equal(growth.data.guest, false)
  assert.equal(growth.data.loading, false)
  assert.equal(growth.data.error, '')
  assert(growth.data.data.child.id)
  assert.equal(growth.data.data.dimensions.length, 6)
})

test('登录返回目标只接受固定入口，不能用参数跳转任意地址', t => {
  const h = environment(t)
  h.access.requestLogin('https://external.invalid')
  assert.equal(h.routes.at(-1).url, '/pages/auth/privacy?next=')
  h.access.browse('../../private')
  assert.equal(h.routes.at(-1).url, '/pages/home/index')
})
