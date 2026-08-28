const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null },
  async submit() {
    const ok = await util.confirm('撤回同意', '撤回后无法继续使用家庭、位置与成长服务。')
    if (!ok) return
    api.submitTask('consent-withdraw', {}).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => { if (x) util.toast(x.message) }).catch((e) => util.failToast(e))
  }
})
