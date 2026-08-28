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
    refreshing: false
  },
  onShow() {
    util.setTab(1)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    Promise.all([api.getLocation(), api.getChildren()]).then(([loc, children]) => {
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
        relative: util.formatRelative(loc.updatedAt)
      })
    }).catch((e) => util.failToast(e))
  },
  onRefresh() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    api.refreshLocation().then((res) => {
      util.toast(res.message)
      this.reload()
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ refreshing: false }))
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) }
})
