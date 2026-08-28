const store = require('./services/store')
const api = require('./services/api')

App({
  onLaunch() {
    store.init()
    const sys = wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight || 44
    this.globalData.navBarHeight = (sys.statusBarHeight || 44) + 44
    this.globalData.windowWidth = sys.windowWidth
    this.routeBySession()
  },

  routeBySession() {
    const session = store.getSession()
    if (!session.privacyAccepted) {
      return
    }
    if (!session.loggedIn) {
      wx.redirectTo({ url: '/pages/auth/login' })
      return
    }
    if (!session.familyReady) {
      wx.redirectTo({
        url: session.familyCreated ? '/pages/family/bind' : '/pages/family/create'
      })
      return
    }
    wx.switchTab({ url: '/pages/home/index' })
  },

  globalData: {
    statusBarHeight: 44,
    navBarHeight: 88,
    windowWidth: 375
  },

  store,
  api
})
