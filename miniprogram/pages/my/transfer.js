const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  async go() {
    const ok = await util.confirm('确认转移', '你将失去主管理员权限。此操作不可仅以前端成功结束。')
    if (!ok) return
    if (this.data.busy) return
    this.setData({ busy: true })
    api.submitTask('admin-transfer', {}).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => util.toast(x.message)).catch((e) => util.failToast(e)).finally(() => this.setData({ busy: false }))
  }
})
