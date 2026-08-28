const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null },
  async submit() {
    const ok = await util.confirm('申请注销', '若你是唯一主管理员，需先转移或解散家庭。')
    if (!ok) return
    api.submitTask('account-cancel', {}).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => { if (x) util.toast(x.message) }).catch((e) => util.failToast(e))
  }
})
