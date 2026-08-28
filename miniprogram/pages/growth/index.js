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
    util.setTab(2)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    const first = this.data.loading || !this.data.data.child || !this.data.data.child.id
    if (first) this.setData({ loading: true, error: '' })
    Promise.all([api.getGrowth(), api.getChildren()]).then(([data, children]) => {
      this.setData({ data, children, empty: !!data.empty, loading: false, error: '' })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ loading: false, error: (e && e.message) || '网络不可用，请稍后重试' })
    })
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  onChildChange() { this.setData({ loading: true }); this.reload() },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  goReport(e) {
    const { id, type } = e.currentTarget.dataset
    wx.navigateTo({ url: type === 'phase' ? '/pages/growth/phase?id=' + id : '/pages/growth/weekly?id=' + id })
  },
  goAch(e) { wx.navigateTo({ url: '/pages/growth/achievement?id=' + e.currentTarget.dataset.id }) }
})
