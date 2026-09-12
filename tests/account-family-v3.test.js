const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createWxMock } = require('./helpers')

const mini = path.resolve(__dirname, '../miniprogram') + path.sep
const input = (value) => ({ detail: { value } })
const event = (dataset) => ({ currentTarget: { dataset } })

function harness(t, authenticated = true) {
  const original = {
    wx: global.wx, Page: global.Page, getCurrentPages: global.getCurrentPages, getApp: global.getApp,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout
  }
  Object.keys(require.cache).filter((key) => key.startsWith(mini)).forEach((key) => delete require.cache[key])
  createWxMock()
  let now = 1799900000000, timerId = 0, definition
  const timers = new Map(), mounted = [], routes = [], toasts = [], modals = []
  const state = { confirm: true, scan: null, externalCalls: 0 }
  const record = (method) => (options = {}) => { routes.push({ method, url: options.url }); if (options.success) options.success({}) }
  Object.assign(global.wx, {
    navigateTo: record('navigateTo'), redirectTo: record('redirectTo'), switchTab: record('switchTab'),
    reLaunch: record('reLaunch'), navigateBack: record('navigateBack'), exitMiniProgram: record('exitMiniProgram'),
    showToast: (options) => toasts.push(options.title),
    showModal: (options) => { modals.push(options); options.success({ confirm: state.confirm }) },
    scanCode: (options) => { state.scan = options },
    requestSubscribeMessage() { state.externalCalls += 1; throw new Error('演示订阅不应请求真实微信订阅') },
    request() { state.externalCalls += 1; throw new Error('演示反馈不应访问真实服务') }
  })
  global.getCurrentPages = () => mounted
  global.getApp = () => ({ globalData: { statusBarHeight: 44 } })
  global.Page = (value) => { definition = value }
  // 手动调度传输/轮询计时器；回调不会在注册时同步执行。
  global.setTimeout = (fn, delay = 0) => {
    const id = ++timerId
    timers.set(id, { at: now + delay, fn })
    return id
  }
  global.clearTimeout = (id) => timers.delete(id)
  const store = require('../miniprogram/services/store')
  const mock = require('../miniprogram/services/mock')
  const api = require('../miniprogram/services/api')
  store.init()
  if (authenticated) store.setSession({ privacyAccepted: true, loggedIn: true, familyCreated: true, familyReady: true, role: '主管理员' })
  mock.__setClock(() => now)
  async function flush(count = 80) { for (let i = 0; i < count; i++) await Promise.resolve() }
  async function advance(ms = 2500) {
    await flush()
    const until = now + ms
    for (;;) {
      const due = Array.from(timers.entries()).filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      due[1].fn()
      await flush()
    }
    now = until
    await flush()
  }
  async function open(name, query = {}) {
    const source = path.join(mini, 'pages', name + '.js')
    delete require.cache[source]
    require(source)
    const page = Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data || {})),
      setData(patch) {
        assert(!this.__disposed, name + ' 卸载后不应再 setData')
        Object.assign(this.data, patch)
      }
    })
    mounted.push(page)
    if (page.onLoad) page.onLoad(query)
    if (page.onShow) page.onShow()
    await flush()
    return page
  }
  function close(page) {
    if (!mounted.includes(page)) return
    if (page.onHide) page.onHide()
    if (page.onUnload) page.onUnload()
    page.__disposed = true
    mounted.splice(mounted.indexOf(page), 1)
  }
  async function act(page, method, argument, elapsed = 2500) {
    const result = page[method](argument)
    await advance(elapsed)
    return result
  }
  function lastRoute() { return routes[routes.length - 1] }
  t.after(async () => {
    mounted.slice().forEach(close)
    await flush()
    timers.clear()
    mock.__setClock()
    Object.keys(original).forEach((key) => { global[key] = original[key] })
  })
  return { store, mock, api, state, routes, toasts, modals, open, close, flush, advance, act, lastRoute }
}

test('首次进入经隐私、登录到创建家庭，创建必须等待任务完成', async (t) => {
  const h = harness(t, false)
  const welcome = await h.open('auth/welcome')
  assert.equal(h.routes.length, 0)
  welcome.onStart()
  assert.equal(h.lastRoute().url, '/pages/auth/privacy')
  const privacy = await h.open('auth/privacy')
  privacy.onAgree()
  await h.flush()
  assert.equal(h.store.getSession().privacyAccepted, true)
  assert.match(h.lastRoute().url, /^\/pages\/auth\/login/)
  const login = await h.open('auth/login')
  login.onLogin()
  await h.flush()
  assert.equal(h.store.getSession().loggedIn, true)
  assert.equal(h.lastRoute().url, '/pages/family/create')
  const create = await h.open('family/create')
  create.onName(input('新的测试家庭'))
  create.onRel(input('妈妈'))
  create.onCreate()
  await h.flush()
  assert.equal(create.data.loading, true)
  assert.equal(h.store.getSession().familyCreated, false)
  await h.advance(700)
  assert.equal(h.store.getSession().familyCreated, false)
  await h.advance(1500)
  assert.equal(h.store.getSession().familyCreated, true)
  assert.equal(h.store.getSession().familyName, '新的测试家庭')
  assert.equal(h.lastRoute().url, '/pages/family/bind')
})

test('隐私拒绝不会登录；登录失败与家庭创建失败不推进流程', async (t) => {
  const h = harness(t, false)
  const privacy = await h.open('auth/privacy')
  privacy.onDecline()
  assert.equal(h.lastRoute().url, '/pages/auth/declined')
  assert.equal(h.store.getSession().privacyAccepted, false)
  const declined = await h.open('auth/declined')
  declined.retry()
  assert.equal(h.lastRoute().method, 'navigateBack')
  await h.api.acceptPrivacy()
  global.wx.login = ({ fail }) => fail({ errMsg: 'network failed' })
  const login = await h.open('auth/login')
  login.onLogin()
  await h.flush()
  assert.equal(h.store.getSession().loggedIn, false)
  assert(login.data.error)
  h.store.setSession({ loggedIn: true })
  h.store.setScenario('fail')
  const create = await h.open('family/create')
  const count = h.routes.length
  await h.act(create, 'onCreate')
  assert.equal(h.store.getSession().familyCreated, false)
  assert.equal(create.data.loading, false)
  assert.equal(h.routes.length, count)
  assert(h.toasts.some((text) => /失败/.test(text)))
})

test('绑定码校验、扫码权限失败和设备拒绝不会假绑定成功', async (t) => {
  const h = harness(t)
  h.store.setSession({ familyReady: false })
  const bind = await h.open('family/bind')
  for (const code of ['12', '000000', '111111', '999999']) {
    bind.onCode(input(code))
    bind.onSubmit()
    await h.flush()
    assert(bind.data.error)
  }
  bind.onScan()
  h.state.scan.fail({ errMsg: 'camera permission denied' })
  assert.match(bind.data.error, /相机权限/)
  h.state.scan.success({ result: 'https://invalid.example/code' })
  assert.match(bind.data.error, /有效的 6 位/)
  h.store.setScenario('fail')
  bind.onCode(input('123456'))
  bind.onSubmit()
  await h.flush()
  const taskId = h.lastRoute().url.split('taskId=')[1]
  const waiting = await h.open('family/waiting', { taskId })
  await h.advance()
  assert.equal(waiting.data.failed, true)
  assert.equal(waiting.data.polling, false)
  assert.equal(h.store.getSession().familyReady, false)
  assert(!h.routes.some((route) => route.url === '/pages/family/success'))
})

test('绑定成功等待终态后选中目标孩子，并可查看成功页', async (t) => {
  const h = harness(t)
  h.store.setSession({ familyReady: false })
  const bind = await h.open('family/bind')
  bind.onScan()
  h.state.scan.success({ result: 'ailab:bind:654321' })
  assert.equal(bind.data.code, '654321')
  bind.onSubmit()
  await h.flush()
  const taskId = h.lastRoute().url.split('taskId=')[1]
  const waiting = await h.open('family/waiting', { taskId })
  assert.equal(waiting.data.polling, true)
  assert.equal(h.store.getSession().familyReady, false)
  await h.advance()
  assert.equal(h.lastRoute().url, '/pages/family/success')
  assert.equal(h.store.getCurrentChildId(), 'child-xinghe')
  assert.equal(h.store.getSession().familyReady, true)
  const success = await h.open('family/success')
  assert.equal(success.data.childName, '陈星河')
  success.goHome()
  assert.deepEqual(h.lastRoute(), { method: 'switchTab', url: '/pages/home/index' })
})

test('绑定等待页超时可查询同一任务到终态，不创建新绑定', async (t) => {
  const h = harness(t)
  h.store.setSession({ familyReady: false })
  h.store.setScenario('timeout')
  const task = await h.api.bindChild({ code: '333333' })
  const waiting = await h.open('family/waiting', { taskId: task.id })
  await h.advance(2200)
  assert.equal(waiting.data.failed, true)
  assert.equal(h.store.getSession().familyReady, false)
  await h.advance(3500)
  await h.act(waiting, 'refresh', undefined, 800)
  assert.equal(h.lastRoute().url, '/pages/family/success')
  assert.equal(Object.values(h.store.getTasks()).filter((item) => item.type === 'child-bind').length, 1)
  const empty = await h.open('family/waiting')
  assert.equal(empty.data.failed, true)
  assert.equal(empty.data.polling, false)
})

test('扫码异步结果晚于页面卸载时不回写已销毁页面', async (t) => {
  const h = harness(t)
  const bind = await h.open('family/bind')
  bind.onScan()
  const callbacks = h.state.scan
  h.close(bind)
  assert.doesNotThrow(() => callbacks.success({ result: 'ailab:bind:123456' }))
  assert.doesNotThrow(() => callbacks.fail({ errMsg: 'camera denied' }))
})

test('设备详情解绑与设备中心重绑以任务成功为准', async (t) => {
  const h = harness(t)
  const detail = await h.open('my/device-detail', { id: 'dev-mini-01' })
  assert.equal(detail.data.isAdmin, true)
  detail.unbind()
  assert.equal(detail.data.confirm, true)
  const removing = detail.ok()
  await h.flush()
  assert.equal(detail.data.removed, false)
  await h.advance()
  await removing
  assert.equal(detail.data.removed, true)
  assert.equal((await h.api.getLocation()).status, 'unbound')
  const center = await h.open('my/device')
  assert(!center.data.list.some((item) => item.id === 'dev-mini-01'))
  await h.act(center, 'bind')
  assert.equal(center.data.task.status, 'success')
  assert(center.data.list.some((item) => item.id === 'dev-mini-01'))
  assert.equal((await h.api.getLocation()).status, 'valid')
})

test('家庭接受邀请、转移主管理员并撤销原管理员配置权限', async (t) => {
  const h = harness(t)
  const family = await h.open('my/family')
  assert.equal(family.data.family.members.find((item) => item.id === 'u3').pending, true)
  await h.act(family, 'accept', event({ id: 'u3' }))
  assert.equal(family.data.family.members.find((item) => item.id === 'u3').pending, false)
  const transfer = await h.open('my/transfer')
  transfer.select(event({ id: 'u3' }))
  await h.act(transfer, 'go')
  assert.equal(transfer.data.done, true)
  assert.equal(transfer.data.isAdmin, false)
  assert.equal((await h.api.getFamily()).adminId, 'u3')
  const detail = await h.open('my/device-detail', { id: 'dev-mini-01' })
  detail.unbind()
  assert.equal(detail.data.confirm, false)
  await assert.rejects(h.api.submitTask('device-unbind', { id: 'dev-mini-01' }), (err) => err.code === 'FORBIDDEN')
})

test('儿童资料查看后支持连续两次更正，不把处理记录当成未完成任务', async (t) => {
  const h = harness(t)
  const privacy = await h.open('my/privacy')
  await h.act(privacy, 'submit')
  assert.equal(privacy.data.result.child.id, 'child-xiaoman')
  privacy.inputName(input('小满一号'))
  await h.act(privacy, 'correct')
  assert.equal((await h.api.getContext()).child.name, '小满一号')
  privacy.inputName(input('小满二号'))
  await h.act(privacy, 'correct')
  assert.equal((await h.api.getContext()).child.name, '小满二号')
  assert.equal(privacy.data.name, '小满二号')
})

test('儿童数据删除尊重取消确认，仅删除当前孩子的探索记录', async (t) => {
  const h = harness(t)
  const before = await h.api.getContext()
  const page = await h.open('my/delete')
  h.state.confirm = false
  await h.act(page, 'submit')
  assert.equal((await h.api.getGrowth()).empty, false)
  assert.equal(page.data.task, null)
  h.state.confirm = true
  await h.act(page, 'submit')
  assert.equal(page.data.task.status, 'success')
  assert.equal((await h.api.getGrowth()).empty, true)
  assert.equal((await h.api.getContext()).child.name, before.child.name)
  assert.equal((await h.api.getDevices()).length, 2)
  h.store.setCurrentChildId('child-xinghe')
  assert.equal((await h.api.getGrowth()).empty, false)
})

test('消息打开先标已读，tab 地址走 switchTab，详情地址走 navigateTo', async (t) => {
  const h = harness(t)
  const getMessages = h.api.getMessages
  h.api.getMessages = async () => (await getMessages()).concat({ id: 'contract-tab', title: '守护状态', url: '/pages/guard/index', unread: true })
  const page = await h.open('my/message')
  await page.open(event({ id: 'm1' }))
  assert.deepEqual(h.lastRoute(), { method: 'navigateTo', url: '/pages/my/family' })
  assert.equal(page.data.list.find((item) => item.id === 'm1').unread, false)
  await page.open(event({ id: 'contract-tab' }))
  assert.deepEqual(h.lastRoute(), { method: 'switchTab', url: '/pages/guard/index' })
  assert(h.store.getReadMessageIds().includes('contract-tab'))
})

test('订阅只保存本地偏好，不调用真实微信订阅', async (t) => {
  const h = harness(t)
  const page = await h.open('my/subscribe')
  assert.equal(page.data.enabled, false)
  h.state.confirm = false
  await h.act(page, 'ask')
  assert.equal((await h.api.getSubscription()).enabled, false)
  h.state.confirm = true
  await h.act(page, 'ask')
  assert.equal(page.data.enabled, true)
  assert.equal((await h.api.getSubscription()).isDemo, true)
  assert.match(h.modals[h.modals.length - 1].content, /不会.*真实订阅/)
  const reopened = await h.open('my/subscribe')
  assert.equal(reopened.data.enabled, true)
  await h.act(reopened, 'ask')
  assert.equal((await h.api.getSubscription()).enabled, false)
  assert.equal(h.state.externalCalls, 0)
})

test('反馈校验、保存及支持页查询串联，不假称已发送客服', async (t) => {
  const h = harness(t)
  const feedback = await h.open('my/feedback')
  feedback.onInput(input('短'))
  feedback.send()
  await h.flush()
  assert.equal((await h.api.getFeedbacks()).length, 0)
  feedback.onInput(input('希望设备离线时有更明显的状态提示'))
  feedback.onCategory(input('1'))
  await h.act(feedback, 'send')
  assert.equal(feedback.data.submitted, true)
  assert.equal(feedback.data.text, '')
  const support = await h.open('my/support')
  assert.equal(support.data.feedbacks.length, 1)
  assert.match(support.data.feedbacks[0].text, /设备离线/)
  assert.equal(support.data.feedbacks[0].status, 'local-pending')
  assert.match(support.data.feedbacks[0].message, /未发送真实客服/)
  assert.equal(h.state.externalCalls, 0)
})

test('撤回同意和本地注销显示终态并清除登录，允许返回欢迎页', async (t) => {
  const h = harness(t)
  const withdraw = await h.open('my/withdraw')
  await h.act(withdraw, 'submit')
  assert.equal(withdraw.data.task.status, 'success')
  assert.equal(h.store.getSession().privacyAccepted, false)
  assert.equal(h.store.getSession().loggedIn, false)
  withdraw.finish()
  assert.deepEqual(h.lastRoute(), { method: 'reLaunch', url: '/pages/auth/welcome' })
  h.store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: true, role: '普通成员' })
  const cancel = await h.open('my/cancel')
  await h.act(cancel, 'submit')
  assert.equal(cancel.data.task.status, 'success')
  assert.equal(h.store.getSession().loggedIn, false)
  assert.equal(h.store.getSession().familyReady, false)
})

test('我的入口、指南、协议、关于与退出路径契约可用', async (t) => {
  const h = harness(t)
  const my = await h.open('my/index')
  assert.equal(my.data.loading, false)
  assert.equal(my.data.child.id, 'child-xiaoman')
  const child = await h.open('my/child')
  assert.equal(child.data.list.length, 2)
  child.bind()
  assert.equal(h.lastRoute().url, '/pages/family/bind')
  const guide = await h.open('my/guide')
  assert(guide.data.list.length > 0)
  guide.open(event({ url: '/pages/guard/index' }))
  assert.equal(h.lastRoute().method, 'switchTab')
  const policy = await h.open('my/policy', { type: 'child' })
  assert.equal(policy.data.title, '儿童信息处理规则')
  const about = await h.open('my/about')
  about.policy(event({ type: 'privacy' }))
  assert.equal(h.lastRoute().url, '/pages/my/policy?type=privacy')
  const account = await h.open('my/account')
  await account.logout()
  assert.equal(h.store.getSession().loggedIn, false)
  assert.deepEqual(h.lastRoute(), { method: 'reLaunch', url: '/pages/auth/welcome' })
})

test('拒绝家庭邀请尊重取消确认，已拒绝成员不再出现在列表', async (t) => {
  const h = harness(t)
  const family = await h.open('my/family')
  h.state.confirm = false
  await h.act(family, 'reject', event({ id: 'u3' }))
  assert.equal(h.store.getInvites().u3, 'pending')
  h.state.confirm = true
  await h.act(family, 'reject', event({ id: 'u3' }))
  assert.equal(h.store.getInvites().u3, 'rejected')
  assert(!family.data.family.members.some((member) => member.id === 'u3'))
})

test('解除孩子关系只移除目标，不能移除家庭最后一名孩子', async (t) => {
  const h = harness(t)
  const child = await h.open('my/child')
  await h.act(child, 'unbind', event({ id: 'child-xinghe' }))
  assert.equal(child.data.list.length, 1)
  assert.equal(child.data.list[0].id, 'child-xiaoman')
  assert.equal(h.store.getCurrentChildId(), 'child-xiaoman')
  await h.act(child, 'unbind', event({ id: 'child-xiaoman' }))
  assert.equal((await h.api.getChildren()).length, 1)
  assert(h.toasts.some((text) => /至少保留/.test(text)))
})

test('体验设置可切换状态、注入去重记录并重置，读取失败可恢复', async (t) => {
  const h = harness(t)
  const debug = await h.open('my/debug')
  await debug.pick(event({ id: 'stale' }))
  assert.equal(debug.data.current, 'stale')
  assert.equal((await h.api.getLocation()).point, null)
  await debug.pick(event({ id: 'default' }))
  const baseline = (await h.api.getGrowth()).progress.completed
  debug.input(input('b04'))
  await debug.inject()
  assert.equal((await h.api.getGrowth()).progress.completed, baseline + 1)
  await debug.inject()
  assert.equal((await h.api.getGrowth()).progress.completed, baseline + 1)
  assert.match(debug.data.lastResult, /已存在/)
  await debug.reset()
  assert.equal((await h.api.getGrowth()).progress.completed, baseline)
  assert.equal(debug.data.lastResult, '已重置')
  h.store.setScenario('offline')
  const messages = await h.open('my/message')
  assert.equal(messages.data.loading, false)
  assert(messages.data.error)
  h.store.setScenario('default')
  await messages.reload()
  assert.equal(messages.data.error, '')
  assert.equal(messages.data.loaded, true)
})
