const { createSyntheticClient } = require('../../services/device/synthetic-location')
const { project } = require('../../services/device/synthetic-view')
const blank = () => ({ hasPoint: false, label: '等待连接本机工具', hint: '请先在电脑控制台生成配对码。', tone: 'muted', remainingSeconds: 0, longitude: '—', latitude: '—', permission: '—', bindingVersion: '—', online: '—', x: 28, y: 70, pointName: '' })
Page({
  data: { unavailable: '', code: '', paired: false, busy: false, error: '', view: blank(), receipt: '', checkedAt: '' },
  onLoad() { this.client = createSyntheticClient({ wxApi: wx }); this.epoch = 0; this.setData({ unavailable: this.client.availability() }) },
  onShow() { this.visible = true; this.epoch++; this.setData({ busy: false }) },
  inputCode(e) { this.setData({ code: e.detail.value.trim().toUpperCase() }) },
  async pair() {
    if (this.data.busy || this.data.unavailable) return
    this.stopTimers(); this.latest = null; this.reading = false
    const epoch = ++this.epoch
    this.setData({ busy: true, error: '', paired: false, view: blank(), receipt: '', checkedAt: '' })
    try {
      await this.client.pair(this.data.code)
      if (!this.visible || epoch !== this.epoch) return
      this.setData({ paired: true, code: '', busy: false })
      await this.read()
    } catch (e) { if (this.visible && epoch === this.epoch) this.setData({ error: e.message || '配对失败', busy: false }) }
  },
  async read() {
    if (!this.visible) return
    if (!this.client.paired()) {
      this.disconnect()
      this.setData({ error: '本机会话已到期或已断开，请在电脑控制台生成新配对码后重新配对。' })
      return
    }
    if (this.reading) return
    this.reading = true
    const epoch = this.epoch, started = Date.now()
    try {
      const data = await this.client.state()
      if (!this.visible || epoch !== this.epoch) return
      if (!this.client.paired()) { this.disconnect(); this.setData({ error: '本机会话已到期，请重新配对。' }); return }
      const view = project(data, started, Date.now())
      this.latest = data; this.requestedAt = started
      this.setData({ view, error: '', receipt: data.lastResult ? data.lastResult.message : '尚未发送报文。', checkedAt: new Date().toLocaleTimeString() })
      this.armExpiry(view)
    } catch (e) {
      if (!this.visible || epoch !== this.epoch) return
      this.latest = null; clearTimeout(this.expiryTimer); this.expiryTimer = null
      this.setData({ view: { ...blank(), label: '暂不显示位置', hint: '连接或权限尚未确认，不保留旧点。' }, receipt: '', checkedAt: '', error: e.message || '读取失败', paired: this.client.paired() })
    } finally {
      if (epoch === this.epoch) { this.reading = false; if (this.visible && this.client.paired()) { clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => this.read(), 2000) } }
    }
  },
  armExpiry(view) {
    clearTimeout(this.expiryTimer); this.expiryTimer = null
    if (!view.hasPoint) return
    // Re-evaluate locally, even if the next network response hangs.
    this.expiryTimer = setTimeout(() => {
      if (!this.visible || !this.latest) return
      const current = project(this.latest, this.requestedAt, Date.now())
      if (current.hasPoint !== this.data.view.hasPoint || current.remainingSeconds !== this.data.view.remainingSeconds) this.setData({ view: current })
      if (!current.hasPoint) this.latest = null
      this.armExpiry(current)
    }, 250)
  },
  refresh() { return this.read() },
  stopTimers() { clearTimeout(this.pollTimer); clearTimeout(this.expiryTimer); this.pollTimer = null; this.expiryTimer = null },
  disconnect() {
    this.epoch++; this.stopTimers(); this.latest = null; this.reading = false
    if (this.client) this.client.clear()
    if (this.visible) this.setData({ paired: false, busy: false, code: '', view: blank(), receipt: '', checkedAt: '', error: '' })
  },
  onHide() { this.disconnect(); this.visible = false },
  onUnload() { this.disconnect(); this.visible = false }
})
