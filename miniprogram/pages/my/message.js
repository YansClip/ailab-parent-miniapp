const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [], loaded: false },
  onShow() {
    api.getMessages().then((list) => this.setData({ list, loaded: true })).catch((e) => {
      util.failToast(e)
      this.setData({ loaded: true })
    })
  },
  sub() { wx.navigateTo({ url: '/pages/my/subscribe' }) },
  open(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (url.indexOf('/pages/growth/weekly') === 0) {
      wx.navigateTo({ url })
      return
    }
    wx.navigateTo({ url })
  }
})
