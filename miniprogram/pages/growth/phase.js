const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { report: {}, busy: false, loading: true, error: '' },
  onLoad(q) {
    this.__disposed = false
    this.rid = q.id || 'p1'
    this.load()
  },
  load() {
    const version = util.beginRequest(this, 'report')
    util.safeSetData(this, { loading: true, error: '' })
    api.getReport(this.rid).then((report) => {
      if (!util.isRequestCurrent(this, 'report', version)) return
      util.safeSetData(this, { report, loading: false })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'report', version)) return
      util.failToast(e)
      util.safeSetData(this, { loading: false, error: (e && e.message) || '报告加载失败' })
    })
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
  },
  onUnload() {
    util.disposePage(this)
  }
})
