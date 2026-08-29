const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createWxMock, fresh } = require('./helpers')

const storePath = path.resolve(__dirname, '../miniprogram/services/store.js')
const mockPath = path.resolve(__dirname, '../miniprogram/services/mock.js')

test('联系人保存任务成功后可重新读取，任务编号不重复', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    fresh(storePath).init()
    const mock = fresh(mockPath)
    const first = await mock.saveContact({ name: '许安', relation: '姑姑', phone: '13600000000', deviceCall: true })
    const second = await mock.submitTask('feedback', { text: '演示反馈' })
    const contacts = await mock.getContacts()
    assert.notEqual(first.id, second.id)
    assert.equal(contacts.some((item) => item.name === '许安' && item.deviceCall), true)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('闹钟保存和删除会更新演示数据', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    fresh(storePath).init()
    const mock = fresh(mockPath)
    await mock.submitTask('alarm-save', { id: 'al9', time: '18:30', label: '回家提醒', repeat: '每天', enabled: true })
    assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), true)
    await mock.submitTask('alarm-delete', { id: 'al9' })
    assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), false)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('失败任务不会提前改变家庭邀请状态', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    const store = fresh(storePath)
    store.init()
    store.setScenario('fail')
    const mock = fresh(mockPath)
    await mock.acceptInvite('u3')
    assert.equal(store.getInvites().u3, 'pending')
  } finally {
    global.setTimeout = originalSetTimeout
  }
})

test('设备解绑成功后守护位置进入未绑定状态', async () => {
  createWxMock()
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (fn) => { fn(); return 1 }
  try {
    fresh(storePath).init()
    const mock = fresh(mockPath)
    await mock.submitTask('device-unbind', { id: 'dev-mini-01' })
    const location = await mock.getLocation()
    assert.equal(location.status, 'unbound')
    assert.equal(location.point, null)
  } finally {
    global.setTimeout = originalSetTimeout
  }
})
