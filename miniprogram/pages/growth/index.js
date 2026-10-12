const api = require('../../services/api')
const access = require('../../services/access')
const util = require('../../utils/util')
const store = require('../../services/store')
const shared = require('./page-utils')
const blank = () => ({ child: {}, insight: {}, brief: {}, progress: {}, plan: [], dimensions: [], reports: [], achievements: [] })
Page({
  data: { guest: true, signedIn: false, statusBarHeight: 44, loading: true, data: blank(), children: [], session: {}, showSwitcher: false, error: '', planExpanded: false },
  onShow() {
    this.__disposed = false
    util.setTab(2)
    if (!access.familyReady()) {
      util.safeSetData(this, { guest: true, signedIn: access.signedIn(), statusBarHeight: util.statusBarHeight(), loading: false, data: blank(), children: [], session: {}, showSwitcher: false, planExpanded: false, error: '' })
      return
    }
    util.safeSetData(this, { guest: false, signedIn: true })
    util.safeSetData(this, { statusBarHeight: util.statusBarHeight(), session: store.getSession() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'growth')
    util.safeSetData(this, { loading: true, error: '' })
    return Promise.all([api.getGrowth(), api.getChildren()]).then(([data, children]) => {
      if (!util.isRequestCurrent(this, 'growth', version)) return
      data = Object.assign(blank(), data)
      data.plan = (data.plan || []).map((lesson) => Object.assign({}, lesson, { completedAt: shared.displayDate(lesson.completedAt), statusText: lesson.status === 'completed' ? '已完成' : lesson.status === 'available' ? '已解锁' : '未解锁' }))
      util.safeSetData(this, { data, children, loading: false, session: store.getSession() }, () => this.drawRadar(data.dimensions || []))
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'growth', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  openSwitcher() { util.safeSetData(this, { showSwitcher: true }) },
  closeSwitcher() { util.safeSetData(this, { showSwitcher: false }) },
  onChildChange() { util.safeSetData(this, { data: blank(), showSwitcher: false, planExpanded: false }); this.reload() },
  togglePlan() { util.safeSetData(this, { planExpanded: !this.data.planExpanded }) },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  goReport(e) {
    const item = e.currentTarget.dataset
    shared.navigate((item.type === 'phase' ? '/pages/growth/phase?id=' : '/pages/growth/weekly?id=') + encodeURIComponent(item.id))
  },
  goAch(e) { shared.navigate('/pages/growth/achievement?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  goDim(e) { shared.navigate('/pages/growth/dimension?key=' + encodeURIComponent(e.currentTarget.dataset.key)) },
  drawRadar(dimensions) {
    if (dimensions.length !== 6 || this.__disposed) return
    const ctx = wx.createCanvasContext('growthRadar', this)
    const cx = 150, cy = 134, radius = 88
    const point = (i, value) => [cx + Math.cos(-Math.PI / 2 + i * Math.PI / 3) * value, cy + Math.sin(-Math.PI / 2 + i * Math.PI / 3) * value]
    const path = (points) => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath() }
    ctx.clearRect(0, 0, 300, 278)
    ctx.setLineWidth(1)
    ;[.25, .5, .75, 1].forEach((scale) => { path(dimensions.map((_, i) => point(i, radius * scale))); ctx.setStrokeStyle('#d6e8f3'); ctx.stroke() })
    dimensions.forEach((_, i) => { const p = point(i, radius); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p[0], p[1]); ctx.setStrokeStyle('#e0edf4'); ctx.stroke() })
    const hasValue = (d) => !d.insufficient && Number.isFinite(d.value)
    // Unknown dimensions have no plotted point, and no filled polygon implies a zero.
    if (dimensions.every(hasValue)) {
      path(dimensions.map((d, i) => point(i, radius * Math.max(0, Math.min(100, d.value)) / 100)))
      ctx.setFillStyle('rgba(30,156,188,.22)'); ctx.fill(); ctx.setStrokeStyle('#1596b6'); ctx.setLineWidth(2.5); ctx.stroke()
    } else {
      dimensions.forEach((d, i) => {
        const next = (i + 1) % 6
        if (!hasValue(d) || !hasValue(dimensions[next])) return
        const a = point(i, radius * d.value / 100), b = point(next, radius * dimensions[next].value / 100)
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.setStrokeStyle('#1596b6'); ctx.setLineWidth(2); ctx.stroke()
      })
    }
    dimensions.forEach((d, i) => {
      if (hasValue(d)) {
        const p = point(i, radius * d.value / 100)
        ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.setFillStyle('#148db3'); ctx.fill()
      }
      const p = point(i, radius + 25)
      ctx.setFontSize(12); ctx.setTextAlign('center'); ctx.setFillStyle('#426884'); ctx.fillText(d.name, p[0], p[1])
      if (!hasValue(d)) { ctx.setFontSize(9); ctx.setFillStyle('#90a6b5'); ctx.fillText('数据不足', p[0], p[1] + 13) }
    })
    ctx.draw()
  },
  onUnload() { util.disposePage(this) }
})
