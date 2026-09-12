const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createWxMock, fresh } = require('./helpers')

const storePath = path.resolve(__dirname, '../miniprogram/services/store.js')
const mockPath = path.resolve(__dirname, '../miniprogram/services/mock.js')

function setup(t) {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  store.setSession({ privacyAccepted: true, loggedIn: true, familyReady: true, role: '主管理员' })
  const mock = fresh(mockPath)
  let now = 1799900000000
  mock.__setClock(() => now)
  t.after(() => mock.__setClock())
  return { store, mock, advance: (ms = 2000) => { now += ms } }
}

test('联系人保存任务成功后可重新读取，任务编号不重复', async (t) => {
  const { mock, advance } = setup(t)
  const first = await mock.saveContact({ name: '许安', relation: '姑姑', phone: '13600000000', deviceCall: true })
  const second = await mock.submitTask('feedback', { text: '演示反馈' })
  assert.notEqual(first.id, second.id)
  assert.equal(first.status, 'submitted')
  assert.equal((await mock.getContacts()).some((item) => item.name === '许安'), false)
  advance(600)
  assert.equal((await mock.getTask(first.id)).status, 'executing')
  advance(1400)
  assert.equal((await mock.getTask(first.id)).status, 'success')
  assert.equal((await mock.getTask(second.id)).status, 'success')
  assert.equal((await mock.getContacts()).some((item) => item.name === '许安' && item.deviceCall), true)
})

test('闹钟保存和删除只在任务成功后更新演示数据', async (t) => {
  const { mock, advance } = setup(t)
  const save = await mock.submitTask('alarm-save', { id: 'al9', time: '18:30', label: '回家提醒', repeat: '每天', enabled: true })
  assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), false)
  advance()
  assert.equal((await mock.getTask(save.id)).status, 'success')
  const saved = (await mock.getAlarms()).find((item) => item.id === 'al9')
  assert.equal(saved.repeat, '每天')
  assert.equal(saved.synced, true)
  const remove = await mock.submitTask('alarm-delete', { id: 'al9' })
  assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), true)
  advance()
  assert.equal((await mock.getTask(remove.id)).status, 'success')
  assert.equal((await mock.getAlarms()).some((item) => item.id === 'al9'), false)
})

test('失败任务不会提前或最终改变家庭邀请状态', async (t) => {
  const { store, mock, advance } = setup(t)
  store.setScenario('fail')
  const task = await mock.acceptInvite('u3')
  assert.equal(store.getInvites().u3, 'pending')
  advance()
  assert.equal((await mock.getTask(task.id)).status, 'failed')
  assert.equal(store.getInvites().u3, 'pending')
  assert.equal((await mock.getFamily()).members.find((item) => item.id === 'u3').pending, true)
})

test('设备解绑成功后守护位置进入未绑定状态', async (t) => {
  const { mock, advance } = setup(t)
  const task = await mock.submitTask('device-unbind', { id: 'dev-mini-01' })
  assert.equal((await mock.getLocation()).status, 'valid')
  advance()
  assert.equal((await mock.getTask(task.id)).status, 'success')
  const location = await mock.getLocation()
  assert.equal(location.status, 'unbound')
  assert.equal(location.point, null)
  assert.equal((await mock.getDevices()).some((device) => device.id === 'dev-mini-01'), false)
})

test('设备离线配置保存与上线同步分别生效', async (t) => {
  const { store, mock, advance } = setup(t)
  store.setScenario('device-offline')
  const task = await mock.saveContact({ id: 'c9', name: '许安', relation: '姑姑', phone: '13600000000', deviceCall: true })
  advance()
  const saved = await mock.getTask(task.id)
  assert.equal(saved.status, 'success')
  assert.equal(saved.synced, false)
  assert.equal((await mock.getContact('c9')).synced, false)
  store.setScenario('default')
  assert.equal((await mock.getContact('c9')).synced, true)
  // 保存任务的历史结果不被后来的设备上线改写。
  assert.equal((await mock.getTask(task.id)).synced, false)
})
