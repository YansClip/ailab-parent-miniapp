const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  async submit() {
    const ok = await util.confirm('提交申请', '将生成可追踪的处理单，并通知结果。')
    if (!ok) return
    util.runTask(this, 'child-data-request', {}).catch(() => {})
  }
})
