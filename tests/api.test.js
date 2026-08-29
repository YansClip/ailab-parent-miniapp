const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createWxMock, fresh } = require('./helpers')

const storePath = path.resolve(__dirname, '../miniprogram/services/store.js')
const mockPath = path.resolve(__dirname, '../miniprogram/services/mock.js')
const apiPath = path.resolve(__dirname, '../miniprogram/services/api.js')

function freshApi() {
  delete require.cache[require.resolve(mockPath)]
  delete require.cache[require.resolve(apiPath)]
  return fresh(apiPath)
}

test('微信登录失败时不写入登录状态', async () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  global.wx.login = ({ fail }) => fail({ errMsg: 'network fail' })
  const api = freshApi()
  await assert.rejects(api.login(), (error) => error.code === 'WECHAT_LOGIN_FAILED')
  assert.equal(store.getSession().loggedIn, false)
})

test('微信登录成功且有 code 时才写入登录状态', async () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  const api = freshApi()
  await api.login()
  assert.equal(store.getSession().loggedIn, true)
})

test('微信登录成功回调缺少 code 时保持未登录', async () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  global.wx.login = ({ success }) => success({})
  const api = freshApi()
  await assert.rejects(api.login(), (error) => error.code === 'LOGIN_CODE_MISSING')
  assert.equal(store.getSession().loggedIn, false)
})

test('消息已读状态按当前孩子保存', async () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  const mock = fresh(mockPath)
  assert.equal((await mock.getMessages()).find((item) => item.id === 'm1').unread, true)
  await mock.markMessageRead('m1')
  assert.equal((await mock.getMessages()).find((item) => item.id === 'm1').unread, false)
  store.setCurrentChildId('child-xinghe')
  assert.equal(store.getReadMessageIds().includes('m1'), false)
})

test('闹钟按孩子隔离，切换后不会串号', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    const store = fresh(storePath)
    store.init()
    const mock = fresh(mockPath)
    await mock.submitTask('alarm-save', { id: 'al9', time: '18:30', label: '回家提醒', repeat: '每天', enabled: true })
    assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), true)
    store.setCurrentChildId('child-xinghe')
    assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), false)
    store.setCurrentChildId('child-xiaoman')
    assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), true)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('联系人按当前孩子隔离', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    const store = fresh(storePath)
    store.init()
    const mock = fresh(mockPath)
    await mock.saveContact({ id: 'c9', name: '许安', relation: '姑姑', phone: '13600000000', deviceCall: true })
    assert.equal((await mock.getContacts()).some((item) => item.id === 'c9'), true)
    store.setCurrentChildId('child-xinghe')
    assert.equal((await mock.getContacts()).some((item) => item.id === 'c9'), false)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('设备任务可区分成功、失败和超时终态', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    const store = fresh(storePath)
    store.init()
    const mock = fresh(mockPath)
    const success = await mock.submitTask('voice-call', {})
    assert.equal((await mock.getTask(success.id)).status, 'success')
    store.setScenario('fail')
    const failed = await mock.submitTask('voice-call', {})
    assert.equal((await mock.getTask(failed.id)).status, 'failed')
    store.setScenario('timeout')
    const timeout = await mock.submitTask('voice-call', {})
    assert.equal((await mock.getTask(timeout.id)).status, 'timeout')
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('儿童信息处理申请成功后可重新查询', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    fresh(storePath).init()
    const mock = fresh(mockPath)
    await mock.submitTask('data-delete', {})
    const request = await mock.getPrivacyRequest('data-delete')
    assert.equal(request.status, 'accepted')
    assert.equal(request.message, '数据删除申请已受理')
  } finally {
    global.setTimeout = originalSetTimeout
  }
})
