const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { item: {} },
  onLoad(q) {
    api.getAchievement(q.id || 'a1').then((item) => this.setData({ item })).catch((e) => util.failToast(e))
  },
  share() { wx.navigateTo({ url: '/pages/growth/share' }) }
})
