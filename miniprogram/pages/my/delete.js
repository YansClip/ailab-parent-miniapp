const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('data-delete').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('申请删除', '删除范围、影响和保留期限将写入处理单。')
    if (!ok) return
    util.runTask(this, 'data-delete', {}).catch(() => {})
  },
  onUnload() {
    util.disposePage(this)
  }
})
