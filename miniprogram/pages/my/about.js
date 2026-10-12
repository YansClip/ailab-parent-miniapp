const access = require('../../services/access')
Page({
  policy(e) { wx.navigateTo({ url: '/pages/my/policy?type=' + e.currentTarget.dataset.type }) },
  fb() { if (!access.familyReady()) { access.requestLogin('my'); return }; wx.navigateTo({ url: '/pages/my/feedback' }) },
  // Setup must be reachable before a real family/device exists. Actions perform their own consent/ACL checks.
  debug() { wx.navigateTo({ url: '/pages/my/debug' }) }
})
