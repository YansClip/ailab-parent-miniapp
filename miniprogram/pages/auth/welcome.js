const access = require('../../services/access')

Page({
  data: { statusBarHeight: 44 },
  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.statusBarHeight || 44 })
    access.browse()
  },
  onStart() {
    access.browse()
  },
  onLogin() { access.requestLogin() },
  onJoin() {
    access.requestLogin('join')
  }
})
