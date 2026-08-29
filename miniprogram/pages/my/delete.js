const util = require('../../utils/util')
Page({
  data: { task: null, busy: false },
  async submit() {
    const ok = await util.confirm('申请删除', '删除范围、影响和保留期限将写入处理单。')
    if (!ok) return
    util.runTask(this, 'data-delete', {}).catch(() => {})
  }
})
