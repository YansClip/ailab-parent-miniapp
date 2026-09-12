const store = require('../../services/store')
const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { statusBarHeight: 44, padTop: 124, childName: '', deviceName: '' },
  onLoad() {
    const statusBarHeight = getApp().globalData.statusBarHeight || 44
    this.setData({ statusBarHeight, padTop: statusBarHeight + 80 })
    api.getChildren().then((list) => {
      const id = store.getCurrentChildId()
      const child = (list || []).find((c) => c.id === id) || {}
      util.safeSetData(this, {
        childName: child.name || '已绑定孩子',
        deviceName: child.deviceName || '尚未绑定设备'
      })
    }).catch((e) => util.failToast(e))
  },
  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },
  onUnload() { util.disposePage(this) }
})
