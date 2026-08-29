const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  async logout() {
    const ok = await util.confirm('退出登录', '退出后将清除本机登录状态，需要重新完成微信登录。')
    if (!ok) return
    store.logout()
    wx.reLaunch({ url: '/pages/auth/welcome' })
  }
})
