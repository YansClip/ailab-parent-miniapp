const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  data: {
    stage: 'ready',
    title: '准备呼叫',
    desc: '将检查设备在线与通话能力',
    child: '小满',
    muted: false,
    speaker: false,
    nr: false,
    taskId: '',
    busy: false,
    seconds: 0,
    deviceOnline: true
  },
  onLoad() {
    this.__disposed = false
    const id = store.getCurrentChildId()
    this.setData({ child: id === 'child-xinghe' ? '星河' : '小满' })
    api.getChildren().then((list) => {
      const child = (list || []).find((item) => item.id === id) || {}
      util.safeSetData(this, { child: child.shortName || this.data.child, deviceOnline: !!child.online })
    }).catch((e) => util.failToast(e))
  },
  startCall() {
    if (this.data.busy || this.data.stage === 'calling') return
    const version = (this.callVersion || 0) + 1
    this.callVersion = version
    this.setData({ busy: true, stage: 'calling', title: '呼叫中', desc: '正在检查设备在线状态…', seconds: 0 })
    api.getLocation().then((loc) => {
      if (this.callVersion !== version) return null
      if (!loc.online) {
        this.setData({
          stage: 'failed',
          title: loc.status === 'unbound' ? '尚未绑定设备' : '设备离线',
          desc: loc.status === 'unbound' ? '请先在设备中心绑定 Mini 设备。' : '离线时无法发起语音通话。待设备上线后重试。',
          busy: false
        })
        return null
      }
      return api.submitTask('voice-call', {}).then((t) => {
        if (this.callVersion !== version) return null
        this.setData({ taskId: t.id, desc: '等待设备接听…' })
        this.callPoll = util.pollTask(t.id, { page: this })
        return this.callPoll.then((x) => {
          if (this.callVersion !== version) return
          if (x.status === 'success') {
            this.setData({ stage: 'connected', title: '已接通', desc: '可静音、扬声器或智能降噪', busy: false })
            this.startDuration()
          } else {
            this.setData({
              stage: 'failed',
              title: '未能接通',
              desc: x.message || '设备忙、离线或超时。可重试。',
              busy: false
            })
          }
        })
      })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ stage: 'failed', title: '未能接通', desc: (e && e.message) || '请稍后重试', busy: false })
    })
  },
  hang() {
    this.callVersion = (this.callVersion || 0) + 1
    if (this.callPoll && this.callPoll.cancel) this.callPoll.cancel()
    this.clearDuration()
    this.setData({ stage: 'ready', title: '通话已结束', desc: '未保存通话内容。可重新呼叫。', busy: false, seconds: 0 })
  },
  retry() {
    this.setData({ stage: 'ready', title: '准备呼叫', desc: '将检查设备在线与通话能力', busy: false })
  },
  toggleMute() { this.setData({ muted: !this.data.muted }) },
  toggleSpk() { this.setData({ speaker: !this.data.speaker }) },
  toggleNr() { this.setData({ nr: !this.data.nr }) },
  startDuration() {
    this.clearDuration()
    this.durationTimer = setInterval(() => util.safeSetData(this, { seconds: this.data.seconds + 1 }), 1000)
  },
  clearDuration() {
    if (this.durationTimer) clearInterval(this.durationTimer)
    this.durationTimer = null
  },
  onUnload() {
    this.callVersion = (this.callVersion || 0) + 1
    if (this.callPoll && this.callPoll.cancel) this.callPoll.cancel()
    this.clearDuration()
    util.disposePage(this)
  }
})
