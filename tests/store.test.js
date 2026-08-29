const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createWxMock, fresh } = require('./helpers')

const storePath = path.resolve(__dirname, '../miniprogram/services/store.js')

test('切换孩子时先发出清理事件，再发出新主体事件', () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  const events = []
  store.on((type, payload) => events.push({ type, payload }))
  store.setCurrentChildId('child-xinghe')
  assert.equal(store.getCurrentChildId(), 'child-xinghe')
  assert.deepEqual(events.map((event) => event.type), ['clear', 'child'])
  assert.equal(events[0].payload.previousId, 'child-xiaoman')
  assert.equal(events[1].payload.id, 'child-xinghe')
})

test('演示业务数据按命名空间读写', () => {
  createWxMock()
  const store = fresh(storePath)
  store.setDemoData('contacts', [{ id: 'c9' }])
  assert.deepEqual(store.getDemoData('contacts', []), [{ id: 'c9' }])
  assert.deepEqual(store.getDemoData('alarms', ['fallback']), ['fallback'])
})

test('退出登录会清除用户相关演示数据', () => {
  createWxMock()
  const store = fresh(storePath)
  store.init()
  store.toggleFollow('fp1')
  store.setDemoData('contacts', [{ id: 'custom' }])
  store.logout()
  assert.deepEqual(store.getFollows(), {})
  assert.deepEqual(store.getDemoData('contacts', []), [])
  assert.equal(store.getSession().loggedIn, false)
})
