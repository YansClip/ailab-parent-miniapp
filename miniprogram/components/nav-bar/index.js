Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    action: { type: String, value: '' }
  },
  data: {
    statusBarHeight: 44,
    navHeight: 88
  },
  lifetimes: {
    attached() {
      const app = getApp()
      const status = (app && app.globalData && app.globalData.statusBarHeight) || 44
      this.setData({
        statusBarHeight: status,
        navHeight: status + 44
      })
    }
  },
  methods: {
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack()
      else wx.switchTab({ url: '/pages/home/index' })
    },
    onAction() {
      this.triggerEvent('action')
    }
  }
})
