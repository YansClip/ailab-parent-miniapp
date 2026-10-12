const access = require('../../services/access')
Page({
  retry() { wx.navigateBack() },
  browse() { access.browse() }
})
