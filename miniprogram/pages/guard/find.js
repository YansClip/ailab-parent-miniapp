const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')
Page({
  data: { stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。', left: 60, taskId: '' },
  start() {
    if (!util.acquire(this)) return
    const childOffline = store.getCurrentChildId() === 'child-xinghe'
    if (childOffline) {
      util.release(this)
      this.setData({ stage: 'offline', title: '设备离线', desc: '离线时不能发起查找。请待设备上线后重试。' })
      return
    }
    api.submitTask('find-device', {}).then((t) => {
      this.setData({ stage: 'ringing', title: '正在查找', desc: '请求已提交，设备响铃中。', left: 60, taskId: t.id })
      const timer = setInterval(() => {
        const left = this.data.left - 1
        if (left <= 0) {
          clearInterval(timer)
          this.timer = null
          if (this.data.stage === 'ringing') {
            this.setData({ stage: 'timeout', title: '查找超时', desc: '可再次发起。超时不等于设备未执行，可查询最终状态。', left: 0 })
            util.release(this)
          }
        } else this.setData({ left })
      }, 1000)
      this.timer = timer
      return util.pollTask(t.id).then((x) => {
        if (this.data.stage !== 'ringing') return
        if (this.timer) { clearInterval(this.timer); this.timer = null }
        if (x.status === 'failed') {
          this.setData({ stage: 'failed', title: '查找失败', desc: x.message || '设备未响应，可重试。' })
        } else if (x.status === 'timeout') {
          this.setData({ stage: 'timeout', title: '查找超时', desc: x.message || '可再次发起查找。' })
        } else {
          this.setData({ stage: 'found', title: '已找到设备', desc: 'Mini 已响应响铃。' })
        }
      })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ stage: 'failed', title: '查找失败', desc: (e && e.message) || '请稍后重试' })
    }).finally(() => util.release(this))
  },
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    util.release(this)
    this.setData({ stage: 'found', title: '已手动停止', desc: '响铃已停止。' })
  },
  reset() {
    util.release(this)
    this.setData({ stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。' })
  },
  onUnload() { if (this.timer) clearInterval(this.timer) }
})
