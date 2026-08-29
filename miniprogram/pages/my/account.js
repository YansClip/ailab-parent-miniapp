const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  async logout() {
    const ok = await util.confirm('退出登录', '将清除本机演示会话和操作记录，可重新走完整登录流程。')
    if (!ok) return
    store.logout()
    wx.reLaunch({ url: '/pages/auth/welcome' })
  }
})
