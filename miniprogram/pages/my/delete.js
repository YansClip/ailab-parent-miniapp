const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null },
  async submit() {
    const ok = await util.confirm('申请删除', '删除范围、影响和保留期限将写入处理单。')
    if (!ok) return
    api.submitTask('data-delete', {}).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => { if (x) util.toast(x.message) }).catch((e) => util.failToast(e))
  }
})
