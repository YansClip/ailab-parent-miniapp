Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    action: { type: String, value: '' }
  },
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    innerHeight: 44,
    menuReserved: 16
  },
  lifetimes: {
    attached() {
      const app = getApp()
      const status = (app && app.globalData && app.globalData.statusBarHeight) || 44
      let innerHeight = 44
      let menuReserved = 16
      try {
        const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
        const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        if (capsule && capsule.height) {
          innerHeight = capsule.height + Math.max(0, capsule.top - status) * 2
          if (capsule.left && windowInfo && windowInfo.windowWidth) {
            menuReserved = Math.max(16, windowInfo.windowWidth - capsule.left + 4)
          }
        }
      } catch (e) {
        console.warn('[AILab nav] capsule metrics unavailable')
      }
      this.setData({
        statusBarHeight: status,
        innerHeight,
        navHeight: status + innerHeight,
        menuReserved
      })
    }
  },
  methods: {
    onBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) wx.navigateBack({ delta: 1, fail: () => wx.showToast({ title: '暂时无法返回，请重试', icon: 'none' }) })
      else wx.switchTab({ url: '/pages/home/index' })
    },
    onAction() {
      this.triggerEvent('action')
    }
  }
})
