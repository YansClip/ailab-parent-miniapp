const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { preview: {}, sheet: false, canShare: false, hiddenText: '' },
  onLoad(q) {
    this.rid = q.id || 'w1'
    this.load()
  },
  load() {
    api.getSharePreview(this.rid).then((preview) => {
      this.setData({
        preview,
        canShare: !preview.generating,
        hiddenText: (preview.hidden || []).join('、')
      })
    }).catch((e) => util.failToast(e))
  },
  openShare() {
    if (!this.data.canShare) {
      util.toast('报告生成中，暂不能分享')
      return
    }
    this.setData({ sheet: true })
  },
  close() { this.setData({ sheet: false }) },
  noop() {},
  doShare() {
    if (!this.data.canShare) return
    util.toast('已按脱敏规则处理')
    this.setData({ sheet: false })
  },
  save() {
    if (!this.data.canShare) return
    util.toast('已保存到相册')
    this.setData({ sheet: false })
  }
})
