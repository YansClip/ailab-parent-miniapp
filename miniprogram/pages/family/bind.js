const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { code: '826410', loading: false, error: '' },
  onCode(e) { this.setData({ code: e.detail.value, error: '' }) },
  onSubmit() {
    if (this.data.loading) return
    const code = (this.data.code || '').trim()
    if (!code || code.length < 4) {
      this.setData({ error: '绑定码格式不正确，请核对后重试。' })
      return
    }
    if (code === '000000') {
      this.setData({ error: '绑定码已过期。请让孩子重新生成一次性绑定码。' })
      return
    }
    if (code === '111111') {
      this.setData({ error: '该绑定码已被使用。' })
      return
    }
    this.setData({ loading: true, error: '' })
    api.bindChild({ code }).then((t) => {
      wx.redirectTo({ url: '/pages/family/waiting?taskId=' + t.id })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ error: (e && e.message) || '提交失败，请重试' })
    }).finally(() => this.setData({ loading: false }))
  }
})
