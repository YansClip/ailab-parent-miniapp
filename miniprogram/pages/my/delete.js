const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { task: null, busy: false },
  onLoad() {
    api.getPrivacyRequest('data-delete').then((task) => {
      if (task) util.safeSetData(this, { task })
    }).catch(() => {})
  },
  async submit() {
    const ok = await util.confirm('确认处理', '仅删除当前孩子的本地互动、报告、成果与关注记录。保留家庭和设备关联，其他孩子不受影响。')
    if (!ok) return
    helper.task(this, 'data-delete', {}).catch(() => {})
  },
  queryTask() { return helper.query(this) },
  finish() { wx.reLaunch({ url: '/pages/auth/welcome' }) },
  onUnload() {
    util.disposePage(this)
  }
})
