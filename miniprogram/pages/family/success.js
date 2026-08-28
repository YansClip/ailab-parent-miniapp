const store = require('../../services/store')
const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { statusBarHeight: 44, padTop: 124, childName: '林小满', deviceName: 'Mini 01' },
  onLoad() {
    const statusBarHeight = getApp().globalData.statusBarHeight || 44
    this.setData({ statusBarHeight, padTop: statusBarHeight + 80 })
    api.getChildren().then((list) => {
      const id = store.getCurrentChildId()
      const child = (list || []).find((c) => c.id === id) || (list || [])[0] || {}
      this.setData({
        childName: child.name || '林小满',
        deviceName: child.deviceName || 'Mini 01'
      })
    }).catch((e) => util.failToast(e))
  },
  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  }
})
