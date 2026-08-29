const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。', left: 60, taskId: '', task: null },
  onLoad() { this.__disposed = false },
  start() {
    if (!util.acquire(this)) return
    api.getLocation().then((loc) => {
      if (!loc.online) {
        util.release(this)
        this.setData({
          stage: 'offline',
          title: loc.status === 'unbound' ? '尚未绑定设备' : '设备离线',
          desc: loc.status === 'unbound' ? '请先在设备中心绑定 Mini 设备。' : '离线时不能发起查找。请待设备上线后重试。'
        })
        return null
      }
      return api.submitTask('find-device', {})
    }).then((t) => {
      if (!t) return null
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
      this.findPoll = util.pollTask(t.id, { page: this, onUpdate: (task) => util.safeSetData(this, { task }) })
      return this.findPoll.then((x) => {
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
    if (this.data.stage !== 'ringing') return
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.findPoll && this.findPoll.cancel) this.findPoll.cancel()
    this.setData({ stage: 'stopping', title: '正在停止响铃', desc: '等待设备确认最终状态…' })
    api.submitTask('find-stop', { sourceTaskId: this.data.taskId }).then((task) => {
      this.stopPoll = util.pollTask(task.id, { page: this, onUpdate: (x) => util.safeSetData(this, { task: x }) })
      return this.stopPoll
    }).then((x) => {
      if (!x) return
      this.setData({ stage: x.status === 'success' ? 'found' : 'failed', title: x.status === 'success' ? '已停止响铃' : '停止失败', desc: x.message })
    }).catch((e) => {
      util.failToast(e)
      util.safeSetData(this, { stage: 'failed', title: '停止失败', desc: (e && e.message) || '请重试' })
    }).finally(() => util.release(this))
  },
  reset() {
    util.release(this)
    this.setData({ stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。' })
  },
  onUnload() {
    if (this.timer) clearInterval(this.timer)
    if (this.findPoll && this.findPoll.cancel) this.findPoll.cancel()
    if (this.stopPoll && this.stopPoll.cancel) this.stopPoll.cancel()
    util.disposePage(this)
  }
})
