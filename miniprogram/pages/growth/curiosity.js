const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('./page-utils')
Page({
  data: { growth: {}, item: {}, entries: [], selectedIndex: 0, loading: true, detailLoading: false, error: '', detailError: '' },
  onLoad(q) { this.__disposed = false; this.requestedId = q.id || '' },
  onShow() { if (util.guardAuth()) this.load() },
  load() {
    const version = util.beginRequest(this, 'brief')
    util.safeSetData(this, { loading: true, error: '', detailError: '', item: {} })
    return Promise.all([api.getGrowth(), api.getHome()]).then(([growth, home]) => {
      if (!util.isRequestCurrent(this, 'brief', version)) return
      const entries = (home.footprints || []).map((item) => Object.assign({}, item, { label: item.date + ' · ' + item.title }))
      let selectedIndex = entries.findIndex((item) => item.id === (this.requestedId || (growth.brief && growth.brief.eventId)))
      if (selectedIndex < 0) selectedIndex = 0
      util.safeSetData(this, { growth, entries, selectedIndex, loading: false })
      if (entries.length) return this.loadEntry(entries[selectedIndex].id)
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'brief', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  loadEntry(id) {
    const version = util.beginRequest(this, 'entry')
    this.requestedId = id
    util.safeSetData(this, { detailLoading: true, detailError: '', item: {} })
    return api.getFootprint(id).then((item) => {
      if (util.isRequestCurrent(this, 'entry', version)) util.safeSetData(this, { item, detailLoading: false })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'entry', version)) util.safeSetData(this, { detailLoading: false, detailError: shared.errorText(e) })
    })
  },
  changeDate(e) {
    const index = Number(e.detail.value)
    const entry = this.data.entries[index]
    if (!entry) return
    util.safeSetData(this, { selectedIndex: index })
    this.loadEntry(entry.id)
  },
  reloadEntry() { if (this.requestedId) this.loadEntry(this.requestedId) },
  openEvent() { if (this.data.item.id) shared.navigate('/pages/home/footprint?id=' + encodeURIComponent(this.data.item.id)) },
  openReport(e) {
    const report = e.currentTarget.dataset
    shared.navigate((report.type === 'phase' ? '/pages/growth/phase?id=' : '/pages/growth/weekly?id=') + encodeURIComponent(report.id))
  },
  onUnload() { util.disposePage(this) }
})
