const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { code: '', loading: false, error: '' },
  onCode(e) { this.setData({ code: e.detail.value, error: '' }) },
  onScan() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (result) => {
        if (!util.pageMounted(this)) return
        const matched = String(result.result || '').trim().match(/^(?:ailab:bind:)?(\d{6})$/)
        if (!matched) {
          this.setData({ error: '没有识别到有效的 6 位绑定码，请改为手动输入。' })
          return
        }
        this.setData({ code: matched[1], error: '' })
      },
      fail: (error) => {
        if (!util.pageMounted(this)) return
        if (error && /cancel/i.test(error.errMsg || '')) return
        this.setData({ error: '扫码未完成，请检查相机权限或手动输入绑定码。' })
      }
    })
  },
  onSubmit() {
    if (this.data.loading) return
    const code = (this.data.code || '').trim()
    if (!/^\d{6}$/.test(code)) {
      this.setData({ error: '请输入 6 位数字绑定码。' })
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
      if (!util.pageMounted(this)) return
      wx.redirectTo({ url: '/pages/family/waiting?taskId=' + t.id })
    }).catch((e) => {
      util.failToast(e)
      util.safeSetData(this, { error: (e && e.message) || '提交失败，请重试' })
    }).finally(() => util.safeSetData(this, { loading: false }))
  },
  onUnload() { util.disposePage(this) }
})
