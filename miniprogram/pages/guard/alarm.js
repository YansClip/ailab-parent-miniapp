const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [] },
  onShow() {
    api.getAlarms().then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  },
  add() { wx.navigateTo({ url: '/pages/guard/alarm-edit' }) },
  edit(e) { wx.navigateTo({ url: '/pages/guard/alarm-edit?id=' + e.currentTarget.dataset.id }) }
})
