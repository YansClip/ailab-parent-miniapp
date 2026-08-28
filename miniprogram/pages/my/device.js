const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [] },
  onShow() {
    api.getDevices().then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  },
  detail(e) { wx.navigateTo({ url: '/pages/my/device-detail?id=' + e.currentTarget.dataset.id }) }
})
