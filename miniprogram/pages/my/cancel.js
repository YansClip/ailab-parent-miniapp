const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('account-cancel').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('确认处理', '将清除本地示例账号状态并退出；不会注销真实微信或AILab账号。正式注销责任须由运营主体确认。')
    if (!ok) return
    helper.task(this, 'account-cancel', {}).catch(() => {})
  },
  queryTask() { return helper.query(this) },
  finish() { wx.reLaunch({ url: '/pages/auth/welcome' }) },
  onUnload() {
    util.disposePage(this)
  }
})
