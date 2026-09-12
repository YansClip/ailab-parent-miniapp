const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { text: '', busy: false, count: 0, categories: ['设备使用', '守护定位', '家庭管理', '成长内容', '账号与隐私', '其他'], categoryIndex: 0, submitted: false },
  onUnload() { util.disposePage(this) },
  onInput(e) { this.setData({ text: e.detail.value, count: (e.detail.value || '').length }) },
  onCategory(e) { this.setData({ categoryIndex: Number(e.detail.value) || 0 }) },
  again() { this.setData({ submitted: false, text: '', count: 0 }) },
  send() {
    const text = (this.data.text || '').trim()
    if (text.length < 5) {
      util.toast('请至少输入 5 个字的问题描述')
      return
    }
    if (this.data.busy) return
    this.setData({ busy: true })
    api.submitTask('feedback', { text, category: this.data.categories[this.data.categoryIndex] }).then((t) => util.pollTask(t.id, { page: this })).then((x) => {
      util.toast(x.message || '已保存到本地反馈记录')
      if (x.status === 'success') util.safeSetData(this, { text: '', count: 0, submitted: true })
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  }
})
