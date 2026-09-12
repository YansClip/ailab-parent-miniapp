const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { setTimeout: realDelay } = require('node:timers/promises')
const { createWxMock, fresh } = require('./helpers')

const storePath = path.resolve(__dirname, '../miniprogram/services/store.js')
const mockPath = path.resolve(__dirname, '../miniprogram/services/mock.js')
const apiPath = path.resolve(__dirname, '../miniprogram/services/api.js')

function setup(t, authenticated = true) {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  if (authenticated) store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: true, role: '主管理员' })
  const mock = fresh(mockPath)
  const api = fresh(apiPath)
  let now = 1799900000000
  mock.__setClock(() => now)
  t.after(() => mock.__setClock())
  return { store, mock, api, advance: (ms = 2000) => { now += ms } }
}

test('微信登录失败时不写入登录状态', async (t) => {
  const { store, api } = setup(t, false)
  await api.acceptPrivacy()
  global.wx.login = ({ fail }) => fail({ errMsg: 'network fail' })
  await assert.rejects(api.login(), (error) => error.code === 'WECHAT_LOGIN_FAILED')
  assert.equal(store.getSession().loggedIn, false)
})

test('微信登录成功且有 code、已同意隐私时才写入登录状态', async (t) => {
  const { store, api } = setup(t, false)
  await api.acceptPrivacy()
  const result = await api.login()
  assert.equal(result.ok, true)
  assert.equal(result.isDemo, true)
  assert.equal(store.getSession().loggedIn, true)
})

test('未同意隐私时即使微信返回 code 也不能登录', async (t) => {
  const { store, api } = setup(t, false)
  await assert.rejects(api.login(), (error) => error.code === 'PRIVACY_REQUIRED')
  assert.equal(store.getSession().loggedIn, false)
  await assert.rejects(api.getContacts(), (error) => error.code === 'AUTH_REQUIRED')
})

test('微信登录成功回调缺少 code 时保持未登录', async (t) => {
  const { store, api } = setup(t, false)
  await api.acceptPrivacy()
  global.wx.login = ({ success }) => success({})
  await assert.rejects(api.login(), (error) => error.code === 'LOGIN_CODE_MISSING')
  assert.equal(store.getSession().loggedIn, false)
})

test('消息已读状态按当前孩子保存', async (t) => {
  const { store, api } = setup(t)
  assert.equal((await api.getMessages()).find((item) => item.id === 'm1').unread, true)
  await api.markMessageRead('m1')
  assert.equal((await api.getMessages()).find((item) => item.id === 'm1').unread, false)
  store.setCurrentChildId('child-xinghe')
  assert.equal((await api.getMessages()).find((item) => item.id === 'm1').unread, true)
  assert.equal(store.getReadMessageIds().includes('m1'), false)
})

test('闹钟按孩子隔离，切换后不会串号', async (t) => {
  const { store, api, advance } = setup(t)
  const task = await api.submitTask('alarm-save', { id: 'al9', time: '18:30', label: '回家提醒', repeat: '每天', enabled: true })
  advance()
  assert.equal((await api.getTask(task.id)).status, 'success')
  assert.equal((await api.getAlarms()).some((item) => item.id === 'al9'), true)
  store.setCurrentChildId('child-xinghe')
  assert.equal((await api.getAlarms()).some((item) => item.id === 'al9'), false)
  await assert.rejects(api.getTask(task.id), (error) => error.code === 'TASK_FORBIDDEN')
  store.setCurrentChildId('child-xiaoman')
  assert.equal((await api.getAlarms()).some((item) => item.id === 'al9'), true)
})

test('联系人按当前孩子隔离', async (t) => {
  const { store, api, advance } = setup(t)
  const task = await api.saveContact({ id: 'c9', name: '许安', relation: '姑姑', phone: '13600000000', deviceCall: true })
  advance()
  assert.equal((await api.getTask(task.id)).status, 'success')
  assert.equal((await api.getContacts()).some((item) => item.id === 'c9'), true)
  store.setCurrentChildId('child-xinghe')
  assert.equal((await api.getContacts()).some((item) => item.id === 'c9'), false)
  store.setCurrentChildId('child-xiaoman')
  assert.equal((await api.getContact('c9')).name, '许安')
})

test('设备任务区分成功、失败与暂时超时，超时可查到最终结果', async (t) => {
  const { store, api, advance } = setup(t)
  const success = await api.submitTask('voice-call', {})
  assert.equal((await api.getTask(success.id)).status, 'submitted')
  advance()
  assert.equal((await api.getTask(success.id)).status, 'success')
  store.setScenario('fail')
  const failed = await api.submitTask('voice-call', {})
  advance()
  assert.equal((await api.getTask(failed.id)).status, 'failed')
  store.setScenario('timeout')
  const timeout = await api.submitTask('voice-call', {})
  advance()
  const pending = await api.getTask(timeout.id)
  assert.equal(pending.status, 'timeout')
  assert.equal(pending.retryable, true)
  advance(4000)
  assert.equal((await api.getTask(timeout.id)).status, 'success')
})

test('儿童数据删除立即执行本地新契约，并可查询处理记录', async (t) => {
  const { store, api, advance } = setup(t)
  const before = await api.getContext()
  const contactsBefore = await api.getContacts()
  const devicesBefore = await api.getDevices()
  assert.equal((await api.getGrowth()).empty, false)
  const task = await api.submitTask('data-delete', {})
  assert.equal((await api.getGrowth()).empty, false)
  assert.equal(await api.getPrivacyRequest('data-delete'), null)
  advance()
  const result = await api.getTask(task.id)
  assert.equal(result.status, 'success')
  assert.equal(result.finalAfterRevocation, true)
  const request = await api.getPrivacyRequest('data-delete')
  assert.equal(request.id, task.id)
  assert.equal(request.status, 'accepted')
  assert.equal(request.childId, before.childId)
  assert.equal(request.message, result.message)
  assert.match(request.message, /当前孩子的本地.*已删除/)
  assert.equal((await api.getGrowth()).empty, true)
  assert.equal((await api.getContext()).child.name, before.child.name)
  assert.deepEqual(await api.getContacts(), contactsBefore)
  assert.deepEqual(await api.getDevices(), devicesBefore)
  assert(store.getEpoch() > before.epoch)
  store.setCurrentChildId('child-xinghe')
  assert.equal((await api.getGrowth()).empty, false)
  assert.equal(await api.getPrivacyRequest('data-delete'), null)
})

test('真实异步乱序：旧孩子慢响应在新孩子快响应后必须拒绝', async (t) => {
  const { store, api } = setup(t)
  const order = []
  store.setScenario('loading')
  const slow = api.getLocation().then(
    () => { order.push('old-resolved'); throw new Error('旧孩子的响应不应成功') },
    (error) => { order.push('old-rejected'); throw error }
  )
  const rejected = assert.rejects(slow, (error) => error.code === 'STALE_CONTEXT')
  // 使用真实事件循环，让慢请求完成取数并进入 1200ms 传输延迟。
  await realDelay(20)
  store.setScenario('default')
  store.setCurrentChildId('child-xinghe')
  const freshLocation = await api.getLocation()
  order.push('new-resolved')
  assert.equal(freshLocation.childId, 'child-xinghe')
  await rejected
  assert.deepEqual(order, ['new-resolved', 'old-rejected'])
})

test('真实异步登录回调：退出后迟到的旧登录不能覆盖新会话', async (t) => {
  const { store, api } = setup(t, false)
  await api.acceptPrivacy()
  global.wx.login = ({ success }) => { realDelay(30).then(() => success({ code: 'old-code' })) }
  const oldLogin = api.login()
  const rejected = assert.rejects(oldLogin, (error) => error.code === 'CANCELLED')
  store.logout()
  await api.acceptPrivacy()
  global.wx.login = ({ success }) => success({ code: 'new-code' })
  await api.login()
  const newEpoch = store.getEpoch()
  await rejected
  assert.equal(store.getEpoch(), newEpoch)
  assert.equal(store.getSession().loggedIn, true)
  assert.equal(store.getSession().privacyAccepted, true)
})
