const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { taskId: '', statusText: '请求已提交', failed: false, polling: true },
  onLoad(q) {
    const taskId = q.taskId || ''
    this.setData({ taskId, statusText: '等待确认中…', failed: false, polling: true })
    if (taskId) this.poll(taskId)
    else this.setData({ statusText: '未找到绑定任务', failed: true, polling: false })
  },
  poll(id) {
    if (this.bindPoll && this.bindPoll.cancel) this.bindPoll.cancel()
    this.bindPoll = util.pollTask(id, {
      page: this,
      onUpdate: (t) => util.safeSetData(this, { statusText: t.message || '处理中' })
    })
    this.bindPoll.then((t) => {
      if (!util.pageMounted(this) || t.status === 'cancelled') return
      if (t.status === 'success') {
        return api.completeBind(id).then(() => {
          if (!util.pageMounted(this)) return
          wx.redirectTo({ url: '/pages/family/success' })
        })
      }
      this.setData({
        statusText: t.message || '绑定未完成',
        failed: true,
        polling: false
      })
    }).catch((e) => {
      util.failToast(e)
      util.safeSetData(this, { statusText: e.message || '查询失败，可重试', failed: true, polling: false })
    })
  },
  refresh() {
    if (!this.data.taskId) return
    this.setData({ failed: false, polling: true, statusText: '正在查询…' })
    this.poll(this.data.taskId)
  },
  onUnload() {
    if (this.bindPoll && this.bindPoll.cancel) this.bindPoll.cancel()
    util.disposePage(this)
  }
})
