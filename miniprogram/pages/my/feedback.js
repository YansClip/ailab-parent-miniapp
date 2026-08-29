const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { text: '', busy: false, count: 0 },
  onInput(e) { this.setData({ text: e.detail.value, count: (e.detail.value || '').length }) },
  send() {
    const text = (this.data.text || '').trim()
    if (text.length < 5) {
      util.toast('请至少输入 5 个字的问题描述')
      return
    }
    if (this.data.busy) return
    this.setData({ busy: true })
    api.submitTask('feedback', { text }).then((t) => util.pollTask(t.id, { page: this })).then((x) => {
      util.toast(x.message || '已提交，可在专属支持查看进度')
      if (x.status === 'success') this.setData({ text: '', count: 0 })
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  }
})
