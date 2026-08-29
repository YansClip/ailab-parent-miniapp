const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('consent-withdraw').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('撤回同意', '撤回后无法继续使用家庭、位置与成长服务。')
    if (!ok) return
    util.runTask(this, 'consent-withdraw', {}).catch(() => {})
  },
  onUnload() {
    util.disposePage(this)
  }
})
