const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { text: '' },
  onInput(e) { this.setData({ text: e.detail.value }) },
  send() {
    api.submitTask('feedback', { text: this.data.text }).then((t) => util.pollTask(t.id)).then((x) => {
      util.toast(x.message || '已提交，可在专属支持查看进度')
    }).catch((e) => util.failToast(e))
  }
})
