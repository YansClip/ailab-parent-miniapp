const store = require('./services/store')
const api = require('./services/api')

App({
  onLaunch() {
    store.init()
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    this.globalData.statusBarHeight = sys.statusBarHeight || 44
    this.globalData.navBarHeight = (sys.statusBarHeight || 44) + 44
    this.globalData.windowWidth = sys.windowWidth
  },

  globalData: {
    statusBarHeight: 44,
    navBarHeight: 88,
    windowWidth: 375
  },

  store,
  api
})
