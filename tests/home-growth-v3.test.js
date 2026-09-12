const test = require('node:test')
const assert = require('node:assert/strict')
const { createWxMock } = require('./helpers')
const store = require('../miniprogram/services/store')
const api = require('../miniprogram/services/api')
const mock = require('../miniprogram/services/mock')
const util = require('../miniprogram/utils/util')
const shared = require('../miniprogram/pages/growth/page-utils')

function setup() {
  createWxMock()
  store.init()
  store.setSession({ loggedIn: true, privacyAccepted: true, familyCreated: true, familyReady: true, role: '主管理员' })
  mock.__setClock(() => Date.UTC(2026, 8, 12, 4))
  const toasts = [], nav = [], drawings = []
  wx.showToast = (item) => toasts.push(item.title)
  wx.navigateTo = (item) => nav.push(item.url)
  wx.switchTab = (item) => nav.push(item.url)
  wx.redirectTo = (item) => nav.push(item.url)
  wx.createCanvasContext = () => new Proxy({}, {
    get(_, key) {
      if (key === 'measureText') return (text) => ({ width: Array.from(text).length * 9 })
      if (key === 'draw') return (_, callback) => { if (callback) callback() }
      return (...args) => drawings.push([key, args])
    }
  })
  wx.canvasToTempFilePath = (options) => options.success({ tempFilePath: '/tmp/ailab-test-preview.png' })
  return { toasts, nav, drawings }
}
function page(route, query) {
  let config
  global.Page = (value) => { config = value }
  const filename = '../miniprogram/pages/' + route
  delete require.cache[require.resolve(filename)]
  require(filename)
  const result = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)), writes: [] })
  result.setData = function (patch, callback) { Object.assign(this.data, patch); this.writes.push(patch); if (callback) callback() }
  global.getCurrentPages = () => [result]
  if (result.onLoad) result.onLoad(query || {})
  return result
}
async function settle() { await new Promise((resolve) => setImmediate(resolve)) }

test('首页重进会更新待办，切换孩子后摘要和动态保持主体一致', async () => {
  setup()
  const home = page('home/index.js')
  await home.reload()
  const firstId = home.data.home.child.id
  assert.equal(home.data.home.summary.todos, home.data.home.todos.length)
  assert.ok(home.data.groups.length)
  store.setCurrentChildId('child-xinghe')
  home.onShow()
  await settle()
  assert.notEqual(home.data.home.child.id, firstId)
  assert.equal(home.data.home.child.id, 'child-xinghe')
  assert.equal(home.data.home.summary.dynamics, home.data.home.dynamics.length)
  assert.ok(home.data.home.dynamics.every((item) => !item.childId || item.childId === 'child-xinghe'))
  home.onUnload()
})

test('成长进度使用服务映射，日期可读，缺数据雷达不绘制零点或填充', async () => {
  const { drawings } = setup()
  const growth = page('growth/index.js')
  await growth.reload()
  assert.equal(growth.data.data.progress.total, 29)
  assert.equal(growth.data.data.dimensions.length, 6)
  assert.deepEqual(growth.data.data.dimensions.map((d) => d.key), ['system', 'data', 'control', 'ai', 'engineering', 'safety'])
  assert.ok(growth.data.data.plan.filter((p) => p.completedAt).every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.completedAt)))
  drawings.length = 0
  const dims = growth.data.data.dimensions.map((d) => Object.assign({}, d, { insufficient: true }))
  growth.drawRadar(dims)
  assert.equal(drawings.filter(([op]) => op === 'arc').length, 0)
  assert.equal(drawings.filter(([op]) => op === 'fill').length, 0)
  assert.equal(drawings.filter(([op, args]) => op === 'fillText' && args[0] === '数据不足').length, 6)
  growth.onUnload()
})

test('未知足迹展示错误，已知足迹关注经 API 保存且重进保留', async () => {
  setup()
  const home = await api.getHome()
  const id = home.footprints[0].id
  const footprint = page('home/footprint.js', { id })
  await footprint.load()
  const initial = footprint.data.item.followed
  footprint.toggle()
  await settle()
  assert.equal(footprint.data.item.followed, !initial)
  footprint.onShow()
  await settle()
  assert.equal(footprint.data.item.followed, !initial)
  footprint.id = 'missing'
  await footprint.load()
  assert.ok(footprint.data.error)
  footprint.onUnload()
})

test('简报日期选择使用精确事件，关联入口可返回完整足迹', async () => {
  const { nav } = setup()
  const brief = page('growth/curiosity.js')
  await brief.load()
  assert.ok(brief.data.entries.length)
  assert.equal(brief.data.item.id, brief.data.entries[brief.data.selectedIndex].id)
  brief.openEvent()
  assert.equal(nav.pop(), '/pages/home/footprint?id=' + encodeURIComponent(brief.data.item.id))
  brief.onUnload()
})

test('成果分享携带匹配 targetType、targetId 和 childId', async () => {
  const { nav } = setup()
  const growth = await api.getGrowth()
  const id = growth.achievements[0].id
  const achievement = page('growth/achievement.js', { id })
  await achievement.load()
  achievement.share()
  const url = nav.pop()
  assert.ok(url.includes('targetType=achievement'))
  assert.ok(url.includes('targetId=' + encodeURIComponent(id)))
  assert.ok(url.includes('childId=' + growth.child.id))
  achievement.onUnload()
})

test('PNG 使用真实导出路径，拒绝相册权限不提示成功且保留预览', async () => {
  const { toasts } = setup()
  let exported, saving, shown
  wx.canvasToTempFilePath = (options) => { exported = options; options.success({ tempFilePath: '/tmp/real-canvas.png' }) }
  wx.saveImageToPhotosAlbum = (options) => { saving = options }
  wx.previewImage = (options) => { shown = options }
  const share = page('growth/share.js', { targetType: 'report', targetId: 'w1', childId: 'child-xiaoman' })
  await settle()
  assert.equal(exported.fileType, 'png')
  assert.equal(share.data.filePath, '/tmp/real-canvas.png')
  assert.ok(exported.destHeight >= 1240)
  share.save()
  assert.equal(saving.filePath, '/tmp/real-canvas.png')
  assert.ok(!toasts.includes('已保存到相册'))
  saving.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
  assert.ok(share.data.saveError.includes('预览已保留'))
  assert.equal(share.data.filePath, '/tmp/real-canvas.png')
  assert.ok(!toasts.includes('已保存到相册'))
  share.previewImage()
  assert.deepEqual(shown.urls, ['/tmp/real-canvas.png'])
  share.save()
  saving.success()
  assert.deepEqual(toasts, ['已保存到相册'])
  share.onUnload()
})

test('分享内容不匹配或无权限时不能导出；页面销毁后导出回调不写入', async () => {
  setup()
  let exportOptions
  wx.canvasToTempFilePath = (options) => { exportOptions = options }
  const share = page('growth/share.js', { targetType: 'report', targetId: 'w1', childId: 'child-xinghe' })
  await settle()
  assert.equal(share.data.canShare, false)
  assert.ok(share.data.error)
  assert.equal(exportOptions, undefined)
  share.target.childId = 'child-xiaoman'
  await share.load()
  assert.ok(exportOptions)
  share.onUnload()
  const count = share.writes.length
  exportOptions.success({ tempFilePath: '/tmp/late-image.png' })
  assert.equal(share.writes.length, count)
  assert.equal(share.data.filePath, '')
})

test('报告重新进入会重读，生成成功轮询结束后再次读取而非伪造 ready', async () => {
  setup()
  const originalGet = api.getReport
  const originalPoll = util.pollTask
  let reads = 0
  api.getReport = async () => { reads += 1; return { id: 'w1', status: 'ready', title: '已重读报告', childId: 'child-xiaoman' } }
  util.pollTask = async () => ({ status: 'success' })
  try {
    const report = page('growth/weekly.js', { id: 'w1' })
    report.onShow()
    await settle()
    report.onShow()
    await settle()
    assert.equal(reads, 2)
    await report.watch('task-1')
    assert.equal(reads, 3)
    assert.equal(report.data.report.title, '已重读报告')
    assert.equal(report.data.busy, false)
    report.onUnload()
  } finally { api.getReport = originalGet; util.pollTask = originalPoll }
})

test('动态按日期分组且只使用有效提供的来源链接', () => {
  setup()
  const groups = shared.groupEvents([{ id: '1', date: '2026-09-12', type: 'question' }, { id: '2', date: '2026-09-12', type: 'achievement' }, { id: '3', date: '2026-09-11', type: 'course-completed' }])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].items.length, 2)
  assert.equal(groups[1].items[0].typeLabel, '探索完成')
})
