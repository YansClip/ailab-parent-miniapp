const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { next: '' },
  onLoad(q) {
    this.setData({ next: q.next || '' })
  },
  openPolicy(e) {
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: '/pages/my/policy?type=' + type })
  },
  onAgree() {
    api.acceptPrivacy().then(() => {
      wx.navigateTo({ url: '/pages/auth/login?next=' + (this.data.next || '') })
    }).catch((e) => util.failToast(e))
  },
  onDecline() {
    wx.navigateTo({ url: '/pages/auth/declined' })
  }
})
