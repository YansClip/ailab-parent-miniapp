const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('account-cancel').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('申请注销', '若你是唯一主管理员，需先转移或解散家庭。')
    if (!ok) return
    util.runTask(this, 'account-cancel', {}).catch(() => {})
  },
  onUnload() {
    util.disposePage(this)
  }
})
