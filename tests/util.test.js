const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { createWxMock, fresh } = require('./helpers')

const utilPath = path.resolve(__dirname, '../miniprogram/utils/util.js')

test('请求版本只允许最后一次请求更新页面', () => {
  createWxMock()
  const page = { setData() {} }
  global.getCurrentPages = () => [page]
  const util = fresh(utilPath)
  const first = util.beginRequest(page, 'home')
  const second = util.beginRequest(page, 'home')
  assert.equal(util.isRequestCurrent(page, 'home', first), false)
  assert.equal(util.isRequestCurrent(page, 'home', second), true)
})

test('页面销毁后 safeSetData 不再写入', () => {
  createWxMock()
  let writes = 0
  const page = { setData() { writes += 1 } }
  global.getCurrentPages = () => [page]
  const util = fresh(utilPath)
  assert.equal(util.safeSetData(page, { ok: true }), true)
  util.disposePage(page)
  assert.equal(util.safeSetData(page, { ok: false }), false)
  assert.equal(writes, 1)
})

test('切换孩子或结束会话后，已有请求版本也不可回写', () => {
  createWxMock()
  const store = fresh(path.resolve(__dirname, '../miniprogram/services/store.js'))
  store.init()
  const page = { setData() {} }
  global.getCurrentPages = () => [page]
  const util = fresh(utilPath)
  const first = util.beginRequest(page, 'child')
  store.setCurrentChildId('child-xinghe')
  assert.equal(util.isRequestCurrent(page, 'child', first), false)
  const second = util.beginRequest(page, 'child')
  store.bumpEpoch()
  assert.equal(util.isRequestCurrent(page, 'child', second), false)
})

test('取消轮询会结算 Promise 并移除清理句柄，不会永久 pending', async () => {
  createWxMock()
  const page = { setData() {} }
  global.getCurrentPages = () => [page]
  const util = fresh(utilPath)
  const polling = util.pollTask('not-submitted', { page, interval: 50 })
  assert.equal(page.__cancelJobs.length, 1)
  util.disposePage(page)
  const result = await polling
  assert.equal(result.status, 'cancelled')
  assert.equal(page.__cancelJobs.length, 0)
})

test('轮询耗尽不会将执行中的任务当成功', async () => {
  createWxMock()
  const api = require('../miniprogram/services/api')
  const original = api.getTask
  api.getTask = async () => ({ id: 'slow', status: 'executing' })
  const page = { setData() {} }
  global.getCurrentPages = () => [page]
  try {
    const util = fresh(utilPath)
    const result = await util.pollTask('slow', { page, interval: 1, max: 2 })
    assert.equal(result.status, 'timeout')
    assert.equal(result.awaitingFinal, true)
    assert.equal(page.__cancelJobs.length, 0)
  } finally { api.getTask = original }
})

test('通用加载的旧孩子慢响应不能覆盖新孩子结果', async () => {
  createWxMock()
  const store = fresh(path.resolve(__dirname, '../miniprogram/services/store.js'))
  store.init()
  const page = { data: {}, setData(p) { Object.assign(this.data, p) } }
  global.getCurrentPages = () => [page]
  const util = fresh(utilPath)
  const old = util.loadPage(page, () => new Promise((resolve) => setTimeout(() => resolve({ name: 'old-child' }), 25)))
  store.setCurrentChildId('child-xinghe')
  await util.loadPage(page, async () => ({ name: 'new-child' }))
  await old
  assert.equal(page.data.name, 'new-child')
})

test('弹窗API失败会返回取消，不会悬挂操作', async () => {
  createWxMock()
  global.wx.showModal = (options) => options.fail({ errMsg: 'cancel' })
  const util = fresh(utilPath)
  assert.equal(await util.confirm('test', 'test'), false)
})
