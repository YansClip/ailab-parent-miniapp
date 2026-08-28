Page({
  policy(e) { wx.navigateTo({ url: '/pages/my/policy?type=' + e.currentTarget.dataset.type }) },
  fb() { wx.navigateTo({ url: '/pages/my/feedback' }) },
  debug() { wx.navigateTo({ url: '/pages/my/debug' }) }
})
