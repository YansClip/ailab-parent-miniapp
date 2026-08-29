const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: {
    statusBarHeight: 44,
    loading: true,
    empty: false,
    data: { insight: {}, brief: {}, dimensions: [], reports: [], achievements: [], child: {} },
    children: [],
    showSwitcher: false,
    error: ''
  },
  onShow() {
    this.__disposed = false
    util.setTab(2)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'growth')
    this.setData({ loading: true, error: '' })
    Promise.all([api.getGrowth(), api.getChildren()]).then(([data, children]) => {
      if (!util.isRequestCurrent(this, 'growth', version)) return
      this.setData({ data, children, empty: !!data.empty, loading: false, error: '' }, () => {
        if (!data.empty) this.drawRadar(data.dimensions || [])
      })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'growth', version)) return
      util.failToast(e)
      this.setData({ loading: false, error: (e && e.message) || '网络不可用，请稍后重试' })
    })
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  onChildChange() {
    this.setData({
      loading: true,
      empty: false,
      error: '',
      data: { insight: {}, brief: {}, dimensions: [], reports: [], achievements: [], child: {} }
    })
    this.reload()
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  goReport(e) {
    const { id, type } = e.currentTarget.dataset
    wx.navigateTo({ url: type === 'phase' ? '/pages/growth/phase?id=' + id : '/pages/growth/weekly?id=' + id })
  },
  goAch(e) { wx.navigateTo({ url: '/pages/growth/achievement?id=' + e.currentTarget.dataset.id }) },
  goDim(e) { wx.navigateTo({ url: '/pages/growth/dimension?key=' + e.currentTarget.dataset.key }) },
  drawRadar(dimensions) {
    if (!dimensions || dimensions.length !== 6) return
    const ctx = wx.createCanvasContext('growthRadar', this)
    const cx = 150
    const cy = 124
    const radius = 88
    const points = (r) => dimensions.map((_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 3
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
    })
    const path = (list) => {
      ctx.beginPath()
      list.forEach((p, index) => index ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))
      ctx.closePath()
    }
    ctx.setLineWidth(1)
    ;[1, .67, .34].forEach((scale) => {
      path(points(radius * scale))
      ctx.setStrokeStyle('rgba(139,120,230,.22)')
      ctx.stroke()
    })
    points(radius).forEach((p) => {
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(p[0], p[1])
      ctx.setStrokeStyle('rgba(139,120,230,.13)')
      ctx.stroke()
    })
    const values = dimensions.map((item, index) => {
      const value = item.insufficient ? 0 : Math.max(0, Math.min(100, item.value || 0))
      const angle = -Math.PI / 2 + index * Math.PI / 3
      const r = radius * value / 100
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
    })
    path(values)
    ctx.setFillStyle('rgba(139,120,230,.18)')
    ctx.fill()
    ctx.setLineWidth(2)
    ctx.setStrokeStyle('#8b78e6')
    ctx.stroke()
    ctx.draw()
  },
  onUnload() { util.disposePage(this) }
})
