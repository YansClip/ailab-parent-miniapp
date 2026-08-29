const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('child-data-request').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('提交申请', '将生成可追踪的处理单，并通知结果。')
    if (!ok) return
    util.runTask(this, 'child-data-request', {}).catch(() => {})
  },
  onUnload() {
    util.disposePage(this)
  }
})
