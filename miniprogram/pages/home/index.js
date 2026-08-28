const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: {
    statusBarHeight: 44,
    loading: true,
    home: { child: {}, summary: {}, dynamics: [], footprints: [], achievements: [], todos: [], photos: [] },
    parent: {},
    children: [],
    showSwitcher: false,
    error: ''
  },
  onShow() {
    util.setTab(0)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    const first = !this.data.home || !this.data.home.child || !this.data.home.child.id
    if (first) this.setData({ loading: true, error: '' })
    Promise.all([api.getHome(), api.getParent(), api.getChildren()]).then(([home, parent, children]) => {
      this.setData({ home, parent, children, loading: false, error: '' })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ loading: false, error: (e && e.message) || '网络不可用，请稍后重试' })
    })
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  onChildChange() { this.reload() },
  goFootprint(e) {
    wx.navigateTo({ url: '/pages/home/footprint?id=' + (e.currentTarget.dataset.id || 'fp1') })
  },
  goFeed() { wx.navigateTo({ url: '/pages/home/feed' }) },
  goAch(e) { wx.navigateTo({ url: '/pages/growth/achievement?id=' + e.currentTarget.dataset.id }) },
  goUrl(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (url.indexOf('/pages/guard/index') === 0 || url.indexOf('/pages/growth/index') === 0 || url.indexOf('/pages/my/index') === 0) {
      wx.switchTab({ url })
    } else wx.navigateTo({ url })
  },
  goGuide() { wx.navigateTo({ url: '/pages/my/guide' }) }
})
