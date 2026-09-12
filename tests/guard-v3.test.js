const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

test('守护 V3：页面控制器与 API 的完整状态回归', async (t) => {
  const memory = new Map(), timers = new Map()
  let now = 1799900000000, timerId = 0, mounted = [], definition
  const original = {
    now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout,
    setInterval: global.setInterval, clearInterval: global.clearInterval,
    wx: global.wx, Page: global.Page, getCurrentPages: global.getCurrentPages, getApp: global.getApp
  }
  Date.now = () => now
  global.setTimeout = (fn) => {
    const id = ++timerId
    timers.set(id, true)
    Promise.resolve().then(() => {
      if (timers.get(id)) { timers.delete(id); now += 700; fn() }
    })
    return id
  }
  global.clearTimeout = (id) => timers.delete(id)
  global.setInterval = (fn) => { const id = ++timerId; timers.set(id, fn); return id }
  global.clearInterval = (id) => timers.delete(id)
  global.wx = {
    getStorageSync: (key) => memory.get(key) || '',
    setStorageSync: (key, value) => memory.set(key, value),
    showToast() {}, showModal: (options) => options.success({ confirm: true }),
    navigateBack() {}, navigateTo() {}, redirectTo() {}
  }
  global.getCurrentPages = () => mounted
  global.getApp = () => ({ globalData: { statusBarHeight: 44 } })
  global.Page = (value) => { definition = value }
  const store = require('../miniprogram/services/store')
  const mock = require('../miniprogram/services/mock')
  store.init()
  store.setSession({ loggedIn: true, privacyAccepted: true, familyReady: true, role: '主管理员' })
  mock.__setClock(() => now)

  async function flush(count = 100) { for (let i = 0; i < count; i++) await Promise.resolve() }
  async function open(name, query = {}) {
    const source = path.resolve(__dirname, '../miniprogram/pages/guard/' + name + '.js')
    delete require.cache[source]
    require(source)
    const page = Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) {
        assert(!this.__hidden && !this.__disposed, '隐藏或卸载页面不应再 setData')
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
    if (page.onHide) page.onHide()
    if (page.onUnload) page.onUnload()
    mounted = mounted.filter((x) => x !== page)
  }
  const input = (value) => ({ detail: { value } })
  const event = (dataset) => ({ currentTarget: { dataset } })

  try {
    await t.test('过期位置刷新恢复，5 分钟失效清除坐标，地图失败仍保留地址', async () => {
      store.setScenario('stale')
      const page = await open('index')
      assert.equal(page.data.loc.point, null)
      page.onRefresh()
      await flush()
      assert(page.data.loc.point)
      assert.equal(page.data.markers.length, 1)
      const refreshed = page.data.loc.updatedAt
      page._mapNetworkOffline = true
      await page.reload()
      assert.equal(page.data.mapError, true)
      assert(page.data.loc.label)
      assert.equal(page.data.loc.updatedAt, refreshed)
      now += 301000
      page.updateAge()
      assert.equal(page.data.loc.point, null)
      assert.equal(page.data.markers.length, 0)
      close(page)
    })
    await t.test('通话接通、控制、结束与重新进入恢复', async () => {
      store.setScenario('default')
      const page = await open('call')
      await page.startCall()
      assert.equal(page.data.stage, 'calling')
      now += 2000
      page.refreshSession()
      await flush()
      assert.equal(page.data.stage, 'connected')
      for (const control of ['muted', 'speaker', 'nr']) {
        await page.control(event({ control }))
        assert.equal(page.data[control], true)
      }
      page.onHide()
      page.onShow()
      await flush()
      assert.equal(page.data.stage, 'connected')
      assert.equal(page.data.muted, true)
      await page.hang()
      assert.equal(page.data.stage, 'ended')
      close(page)
    })
    await t.test('通话拒接、忙线、超时、失败和设备离线不会显示已接通', async () => {
      for (const [scenario, stage] of [['call-rejected', 'rejected'], ['call-busy', 'busy'], ['timeout', 'timeout'], ['fail', 'failed']]) {
        store.setScenario(scenario)
        const page = await open('call')
        await page.startCall()
        now += 9000
        page.refreshSession()
        await flush()
        assert.equal(page.data.stage, stage)
        close(page)
      }
      store.setScenario('device-offline')
      const page = await open('call')
      await page.startCall()
      assert.notEqual(page.data.stage, 'connected')
      assert(page.data.error.includes('离线'))
      close(page)
    })
    await t.test('查找按真实会话时间倒数，离页恢复、手停、自动到期', async () => {
      store.setScenario('default')
      const page = await open('find')
      await page.start()
      assert.equal(page.data.stage, 'ringing')
      assert.equal(page.data.left, 60)
      assert(!page.data.title.includes('已找到'))
      now += 30000
      page.refreshSession()
      await flush()
      assert.equal(page.data.left, 30)
      page.onHide()
      page.onShow()
      await flush()
      assert.equal(page.data.left, 30)
      await page.stop()
      assert.equal(page.data.stage, 'stopped')
      assert(page.data.title.includes('已停止'))
      await page.start()
      now += 61000
      page.refreshSession()
      await flush()
      assert.equal(page.data.stage, 'expired')
      assert.equal(page.data.left, 0)
      close(page)
    })
    await t.test('联系人校验、保存与 SOS 引用禁停用', async () => {
      const page = await open('contact-edit')
      page.setName(input('测试家人'))
      page.setRel(input('家人'))
      page.setPhone(input('123'))
      page.save()
      assert(page.data.error.includes('11 位'))
      page.setPhone(input('13612345678'))
      page.save()
      await flush()
      assert.equal(page.data.saved, true)
      close(page)
      const referenced = await open('contact-edit', { id: 'c1' })
      assert.equal(referenced.data.referenced, true)
      referenced.toggle()
      assert.equal(referenced.data.deviceCall, true)
      close(referenced)
    })
    await t.test('离线保存闹钟明确待同步，失败不显示保存成功', async () => {
      store.setScenario('device-offline')
      const page = await open('alarm-edit')
      page.onLabel(input('作业提醒'))
      page.onTime(input('17:30'))
      page.onRepeat(input('3'))
      page.save()
      await flush()
      assert.equal(page.data.saved, true)
      assert(page.data.result.includes('待设备'))
      assert.equal(page.data.task.synced, false)
      assert.equal(page.data.task.payload.repeat, '周末')
      close(page)
      store.setScenario('fail')
      const failed = await open('alarm-edit')
      failed.onLabel(input('失败测试'))
      failed.save()
      await flush()
      assert.equal(failed.data.saved, false)
      assert.equal(failed.data.result, '')
      assert(failed.data.error)
      close(failed)
    })
    await t.test('SOS 排序保存，普通成员只读，任务离页不回写', async () => {
      store.setScenario('default')
      const page = await open('sos')
      const id = page.data.list[1].id
      page.move(event({ index: 1, direction: -1 }))
      await flush()
      assert.equal(page.data.list[0].id, id)
      close(page)
      store.setSession({ role: '普通成员' })
      const contacts = await open('contacts')
      assert.equal(contacts.data.canManage, false)
      close(contacts)
      store.setSession({ role: '主管理员' })
      const form = await open('alarm-edit')
      form.onLabel(input('离页任务'))
      form.save()
      close(form)
      await flush()
      assert.equal(form.__disposed, true)
      assert.equal(Array.from(timers.values()).filter((value) => typeof value === 'function').length, 0)
    })
  } finally {
    mounted.slice().forEach(close)
    mock.__setClock()
    Date.now = original.now
    Object.keys(original).filter((key) => key !== 'now').forEach((key) => { global[key] = original[key] })
  }
})
