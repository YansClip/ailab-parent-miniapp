const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('consent-withdraw').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('确认处理', '本机隐私同意将撤回，并结束本地登录状态。此前未完成的任务全部失效。')
    if (!ok) return
    helper.task(this, 'consent-withdraw', {}).catch(() => {})
  },
  queryTask() { return helper.query(this) },
  finish() { wx.reLaunch({ url: '/pages/auth/welcome' }) },
  onUnload() {
    util.disposePage(this)
  }
})
