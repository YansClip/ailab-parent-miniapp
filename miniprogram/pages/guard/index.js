const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: {
    statusBarHeight: 44,
    loc: { child: {}, point: null },
    markers: [],
    relative: '',
    children: [],
    showSwitcher: false,
    refreshing: false,
    loading: true,
    error: ''
  },
  onShow() {
    this.__disposed = false
    util.setTab(1)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'guard')
    this.setData({ loading: true, error: '' })
    Promise.all([api.getLocation(), api.getChildren()]).then(([loc, children]) => {
      if (!util.isRequestCurrent(this, 'guard', version)) return
      const markers = loc.point ? [{
        id: 1,
        latitude: loc.point.latitude,
        longitude: loc.point.longitude,
        width: 28,
        height: 28,
        callout: { content: loc.child.shortName || '当前位置', display: 'ALWAYS', borderRadius: 8, padding: 6 }
      }] : []
      this.setData({
        loc,
        children,
        markers,
        relative: util.formatRelative(loc.updatedAt),
        loading: false,
        error: ''
      })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'guard', version)) return
      util.failToast(e)
      this.setData({ loading: false, error: (e && e.message) || '守护数据加载失败' })
    })
  },
  onRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    api.refreshLocation().then((res) => {
      util.toast(res.message)
      return this.reload()
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ refreshing: false }))
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  onChildChange() {
    this.setData({
      loading: true,
      error: '',
      loc: { child: {}, point: null },
      markers: [],
      relative: ''
    })
    this.reload()
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  onUnload() { util.disposePage(this) }
})
