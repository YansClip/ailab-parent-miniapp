const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { dims: [] },
  onShow() {
    api.getGrowth().then((g) => this.setData({ dims: g.dimensions || [] })).catch((e) => util.failToast(e))
  },
  goDim(e) { wx.navigateTo({ url: '/pages/growth/dimension?key=' + e.currentTarget.dataset.key }) }
})
