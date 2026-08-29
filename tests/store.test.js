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

test('旧版联系人和闹钟缓存会迁移到当前孩子命名空间', () => {
  const { storage } = createWxMock()
  storage.set('ailab.local.version', 2)
  storage.set('ailab.demo.data', {
    contacts: [{ id: 'legacy-contact' }],
    alarms: [{ id: 'legacy-alarm' }]
  })
  const store = fresh(storePath)
  store.init()
  assert.deepEqual(store.getDemoData('contacts.child-xiaoman', []), [{ id: 'legacy-contact' }])
  assert.deepEqual(store.getDemoData('alarms.child-xiaoman', []), [{ id: 'legacy-alarm' }])
  assert.equal(storage.get('ailab.local.version'), 3)
})

test('损坏的对象型缓存会回退为安全默认值', () => {
  const { storage } = createWxMock()
  storage.set('ailab.tasks', null)
  storage.set('ailab.follows', 'invalid')
  storage.set('ailab.demo.data', [])
  storage.set('ailab.invites', null)
  const store = fresh(storePath)
  store.init()
  assert.deepEqual(store.getTasks(), {})
  assert.deepEqual(store.getFollows(), {})
  assert.deepEqual(store.getDemoData('missing', {}), {})
  assert.equal(store.getInvites().u3, 'pending')
})
