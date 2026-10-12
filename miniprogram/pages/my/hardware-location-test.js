const api = require('../../services/api')
const store = require('../../services/store')
const { empty, projectTestLocation } = require('../../services/device/test-location-view')
Page({
  data: { busy: false, watching: false, devices: [], selectedIndex: 0, error: '', view: empty() },
  onLoad() { this.generation = 0 },
  onShow() { this.visible = true; this.stop() },
  current(generation, epoch) { return this.visible && this.generation === generation && store.getEpoch() === epoch && store.getSession().privacyAccepted },
  async load() {
    if (this.data.busy) return
    this.stop(); this.setData({ devices: [], selectedIndex: 0, busy: true, error: '' })
    const generation = this.generation, epoch = store.getEpoch()
    try {
      const rows = await api.getCloudBindings()
      if (!this.current(generation, epoch)) return
      this.setData({ devices: rows, error: rows.length ? '' : '当前微信账号无云端可查看设备，不会补充本地示例。' })
    } catch (e) { if (this.visible && generation === this.generation) this.setData({ error: e.message || '无法读取云端设备' }) }
    finally { if (this.visible && generation === this.generation) this.setData({ busy: false }) }
  },
  select(e) { this.stop(); this.setData({ selectedIndex: Number(e.detail.value), error: '' }) },
  async start() {
    if (this.data.busy || this.data.watching) return
    const scope = this.data.devices[this.data.selectedIndex]
    if (!scope) return
    this.stop()
    if (!store.getSession().privacyAccepted || !scope.permissions.locateDevice) {
      this.setData({ error: '尚未获准查看此设备位置；页面不会自动修改云端授权。' }); return
    }
    this.scope = scope; this.sessionEpoch = store.getEpoch()
    this.setData({ watching: true, error: '' })
    await this.read()
  },
  async read() {
    if (!this.data.watching || this.reading) return
    const generation = this.generation, epoch = this.sessionEpoch, requestedAt = Date.now()
    if (!this.current(generation, epoch)) { this.stop(); return }
    this.reading = true; this.setData({ busy: true })
    try {
      const data = await api.getCloudTestCoordinates(this.scope)
      if (!this.current(generation, epoch)) { if (generation === this.generation) this.stop(); return }
      const view = projectTestLocation(data, this.scope, requestedAt, Date.now())
      this.latest = data; this.requestedAt = requestedAt
      this.setData({ view, error: '' }); this.armExpiry()
    } catch (e) {
      if (!this.visible || generation !== this.generation) return
      this.stop()
      const messages = { INVALID_ACTION: '云端尚未部署测试定位接口，请先完成部署再试。', PROVIDER_NOT_CONFIGURED: '云端硬件定位测试尚未开启，或测试窗口已结束。', FORBIDDEN: '当前账号或设备不在本次测试授权范围内。', BINDING_CHANGED: '设备绑定已改变，请重新读取云端设备。' }
      this.setData({ error: e && (messages[e.code] || e.message) || '连接失败，已清除旧坐标；请手动重试。' })
    } finally {
      if (this.visible && generation === this.generation) {
        this.reading = false; this.setData({ busy: false })
        if (this.data.watching) this.pollTimer = setTimeout(() => this.read(), 5000)
      }
    }
  },
  armExpiry() {
    clearTimeout(this.expiryTimer)
    if (!this.data.watching) return
    this.expiryTimer = setTimeout(() => {
      if (!this.current(this.generation, this.sessionEpoch)) { this.stop(); return }
      if (this.latest) {
        const view = projectTestLocation(this.latest, this.scope, this.requestedAt, Date.now())
        this.setData({ view }); if (!view.hasPoint) this.latest = null
      }
      this.armExpiry()
    }, 250)
  },
  stop() {
    this.generation = (this.generation || 0) + 1
    clearTimeout(this.pollTimer); clearTimeout(this.expiryTimer)
    this.pollTimer = null; this.expiryTimer = null; this.latest = null; this.reading = false; this.scope = null
    this.setData({ busy: false, watching: false, view: empty() })
  },
  onHide() { this.stop(); this.visible = false; this.setData({ devices: [], error: '' }) },
  onUnload() { this.stop(); this.visible = false }
})
