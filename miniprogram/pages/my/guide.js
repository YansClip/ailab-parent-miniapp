const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [] },
  onShow() {
    api.getGuide().then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  },
  open(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (url.indexOf('/pages/guard/index') === 0 || url.indexOf('/pages/growth/index') === 0 || url.indexOf('/pages/home/index') === 0) {
      wx.switchTab({ url })
      return
    }
    wx.navigateTo({ url })
  }
})
