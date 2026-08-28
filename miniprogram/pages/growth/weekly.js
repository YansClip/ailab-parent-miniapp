const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { report: {}, busy: false },
  onLoad(q) { this.rid = q.id || 'w1'; this.load() },
  load() {
    api.getReport(this.rid).then((report) => this.setData({ report })).catch((e) => util.failToast(e))
  },
  retry() {
    if (this.data.busy) return
    this.setData({ busy: true, report: { status: 'generating', title: '正在生成报告' } })
    api.regenerateReport(this.rid).then((t) => util.pollTask(t.id)).then((x) => {
      if (x.status === 'failed' || x.status === 'timeout') {
        this.setData({ report: { status: 'failed', title: '生成失败', message: x.message } })
        return
      }
      this.load()
    }).catch((e) => {
      util.failToast(e)
      this.setData({ report: { status: 'failed', title: '生成失败', message: (e && e.message) || '请重试' } })
    }).finally(() => this.setData({ busy: false }))
  },
  share() {
    if (this.data.report.status !== 'ready') {
      util.toast('报告未就绪，暂不能分享')
      return
    }
    wx.navigateTo({ url: '/pages/growth/share?id=' + this.rid })
  }
})
