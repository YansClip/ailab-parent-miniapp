const store = require('../../services/store')
Page({
  data: {
    current: 'default',
    list: [
      { id: 'default', name: '默认（林小满 · 在线）' },
      { id: 'empty', name: '空数据' },
      { id: 'loading', name: '加载变慢' },
      { id: 'offline', name: '弱网/请求失败' },
      { id: 'stale', name: '位置已过期' },
      { id: 'fail', name: '设备任务失败' },
      { id: 'timeout', name: '任务超时' },
      { id: 'generating', name: '报告生成中' }
    ]
  },
  onShow() { this.setData({ current: store.getScenario() }) },
  pick(e) {
    store.setScenario(e.currentTarget.dataset.id)
    this.setData({ current: e.currentTarget.dataset.id })
    wx.showToast({ title: '已切换场景', icon: 'none' })
  },
  reset() {
    wx.showModal({
      title: '重置测试数据',
      content: '仅清除本机交互记录，不影响登录状态。',
      confirmColor: '#e85d69',
      success: (result) => {
        if (!result.confirm) return
        store.resetDemoData()
        this.setData({ current: 'default' })
        wx.showToast({ title: '已恢复默认数据', icon: 'none' })
      }
    })
  }
})
