Page({
  data: { statusBarHeight: 44 },
  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 44 })
  },
  onStart() {
    wx.navigateTo({ url: '/pages/auth/privacy' })
  },
  onJoin() {
    wx.navigateTo({ url: '/pages/auth/privacy?next=join' })
  }
})
