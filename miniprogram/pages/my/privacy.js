const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null },
  async submit() {
    const ok = await util.confirm('提交申请', '将生成可追踪的处理单，并通知结果。')
    if (!ok) return
    api.submitTask('child-data-request', {}).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => { if (x) util.toast(x.message) }).catch((e) => util.failToast(e))
  }
})
