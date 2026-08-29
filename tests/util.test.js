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
