const api = require('../../services/api')
const helper = require('./helper')
const labels = {
  ready: ['准备呼叫', '点击呼叫后等待 Mini 接听。'],
  calling: ['正在呼叫', '等待设备接听，可随时结束。'],
  connected: ['已接通 · 演示', '通话状态模拟中，未建立真实音频连接。'],
  rejected: ['对方已拒绝', '设备端拒绝了本次呼叫，可以稍后重试。'],
  busy: ['设备忙线', 'Mini 正在其他通话中，请稍后重试。'],
  timeout: ['无人接听', '等待接听已超时，本次呼叫未接通。'],
  failed: ['未能接通', '请检查网络与设备状态后重试。'],
  ended: ['通话已结束', '仅保留本次状态，不保存通话内容。'],
  interrupted: ['通话已中断', '网络或设备连接中断，可以重新呼叫。']
}
Page({
  data: { stage: 'ready', title: '准备呼叫', desc: '', child: '孩子', online: false, loading: true, busy: false, error: '', muted: false, speaker: false, nr: false, duration: '00:00', terminal: false },
  onLoad() { helper.init(this) },
  onShow() { helper.show(this); this.reload(); this.timer = setInterval(() => this.refreshSession(), 1000) },
  onHide() { this.clear(); helper.hide(this) },
  onUnload() { this.clear(); helper.unload(this) },
  clear() { if (this.timer) clearInterval(this.timer); this.timer = null; this.version = (this.version || 0) + 1 },
  reload() {
    helper.read(this, 'call', () => Promise.all([api.getLocation(), api.getCallSession()]), ([loc, session]) => {
      helper.set(this, { child: loc.child.shortName || loc.child.name || '孩子', online: !!loc.online })
      this.applySession(session)
    })
  },
  applySession(session) {
    const stage = session ? session.stage : 'ready'
    const label = labels[stage] || labels.failed
    const seconds = session && session.connectedAt ? Math.max(0, Math.floor(((session.endedAt || Date.now()) - session.connectedAt) / 1000)) : 0
    helper.set(this, { stage, title: label[0], desc: (session && session.reason) || label[1], muted: !!(session && session.muted), speaker: !!(session && session.speaker), nr: !!(session && session.nr), duration: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'), terminal: stage !== 'ready' && stage !== 'calling' && stage !== 'connected' })
  },
  refreshSession() {
    if (this.__hidden || this.data.loading || this.data.busy || this.polling) return
    if (this.data.stage !== 'calling' && this.data.stage !== 'connected') return
    const version = this.version || 0
    this.polling = true
    api.getCallSession().then((session) => {
      if (version !== (this.version || 0) || this.__hidden) return
      helper.set(this, { error: '' }); this.applySession(session)
    }).catch((err) => { if (version === (this.version || 0)) helper.error(this, err) }).finally(() => { this.polling = false })
  },
  startCall() {
    if (this.data.busy || this.data.loading || this.data.stage === 'calling' || this.data.stage === 'connected') return
    return helper.action(this, () => api.startCall(), (session) => this.applySession(session))
  },
  hang() {
    if (this.data.busy) return
    return helper.action(this, () => api.endCall('家长结束通话'), (session) => this.applySession(session))
  },
  control(e) {
    if (this.data.stage !== 'connected' || this.data.busy) return
    const key = e.currentTarget.dataset.control
    if (['muted', 'speaker', 'nr'].indexOf(key) < 0) return
    return helper.action(this, () => api.updateCallControl(key, !this.data[key]), (session) => this.applySession(session))
  }
})
