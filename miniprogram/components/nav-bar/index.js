Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    action: { type: String, value: '' }
  },
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    innerHeight: 44
  },
  lifetimes: {
    attached() {
      const app = getApp()
      const status = (app && app.globalData && app.globalData.statusBarHeight) || 44
      let innerHeight = 44
      try {
        const capsule = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
        if (capsule && capsule.height) innerHeight = capsule.height + Math.max(0, capsule.top - status) * 2
      } catch (e) {
        console.warn('[AILab nav] capsule metrics unavailable')
      }
      this.setData({
        statusBarHeight: status,
        innerHeight,
        navHeight: status + innerHeight
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
