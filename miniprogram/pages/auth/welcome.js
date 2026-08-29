const store = require('../../services/store')

Page({
  data: { statusBarHeight: 44 },
  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 44 })
    const session = store.getSession()
    if (!session.privacyAccepted) return
    if (!session.loggedIn) {
      wx.redirectTo({ url: '/pages/auth/login' })
      return
    }
    if (!session.familyReady) {
      wx.redirectTo({ url: session.familyCreated ? '/pages/family/bind' : '/pages/family/create' })
      return
    }
    wx.switchTab({ url: '/pages/home/index' })
  },
  onStart() {
    wx.navigateTo({ url: '/pages/auth/privacy' })
  },
  onJoin() {
    wx.navigateTo({ url: '/pages/auth/privacy?next=join' })
  }
})
