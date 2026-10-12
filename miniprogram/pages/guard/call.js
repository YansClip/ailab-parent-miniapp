const api = require('../../services/api')
const helper = require('./helper')
const activeStages = ['preparing', 'calling', 'ringing', 'connecting', 'connected', 'ending']
const labels = {
  ready: ['准备呼叫', '点击呼叫后等待 Mini 接听。'],
  preparing: ['正在准备通话', '正在检查设备权限并准备连接。'],
  calling: ['正在呼叫', '等待设备接听，可随时结束。'],
  ringing: ['等待孩子接听', '设备正在响铃，孩子确认前不会开启设备麦克风或摄像头。'],
  connecting: ['正在建立连接', '正在确认双方媒体连接，请稍候。'],
  connected: ['已接通 · 演示', '通话状态模拟中，未建立真实音频连接。'],
  rejected: ['对方已拒绝', '设备端拒绝了本次呼叫，可以稍后重试。'],
  busy: ['设备忙线', 'Mini 正在其他通话中，请稍后重试。'],
  timeout: ['无人接听', '等待接听已超时，本次呼叫未接通。'],
  failed: ['未能接通', '请检查网络与设备状态后重试。'],
  ended: ['通话已结束', '仅保留本次状态，不保存通话内容。'],
  interrupted: ['通话已中断', '网络或设备连接中断，可以重新呼叫。'],
  ending: ['正在确认结束', '本机已尝试停止媒体，等待设备确认。请查询原会话，不要重复呼叫。']
}
Page({
  data: { stage: 'ready', title: '准备呼叫', desc: '', child: '孩子', online: false, loading: true, busy: false, error: '', muted: false, speaker: false, nr: false, cameraOff: false, duration: '00:00', terminal: false, active: false, mediaType: 'voice', pageTitle: '语音通话', isCloud: false, isLab: false, callId: '', supported: true, hasRoom: false },
  onLoad(query = {}) { helper.init(this); this.setData({ mediaType: query.type === 'video' ? 'video' : 'voice', pageTitle: query.type === 'video' ? '视频通话' : '语音通话', isCloud: api.getDeviceMode() === 'cloud', isLab: api.getDeviceMode() === 'lab' }) },
  onShow() { helper.show(this); this.reload(); this.timer = setInterval(() => this.refreshSession(), 1000) },
  onHide() { this.clear(); helper.hide(this) },
  onUnload() { this.clear(); helper.unload(this) },
  clear() { if (this.timer) clearInterval(this.timer); this.timer = null; this.version = (this.version || 0) + 1 },
  reload() {
    return helper.read(this, 'call', async () => { const loc = await api.getCallTarget(); return [loc, await api.getCallSession()] }, ([loc, session]) => {
      helper.set(this, { child: loc.child.shortName || loc.child.name || '孩子', online: !!loc.online, supported: !loc.capabilities || loc.capabilities[this.data.mediaType] === true })
      // A previous ended voice call must not turn the new video entry into voice.
      if (session && !activeStages.includes(session.stage) && (session.mediaType || 'voice') !== this.data.mediaType) session = null
      this.applySession(session)
    })
  },
  applySession(session) {
    const stage = session ? session.stage : 'ready'
    const label = labels[stage] || labels.failed
    const mediaType = session && session.mediaType || this.data.mediaType
    const connectedDescription = this.data.isCloud ? '设备已确认接听及媒体连接；通话操作请使用微信通话界面。' : mediaType === 'video' ? '正在演示双向视频状态，以下插画不是摄像头画面。' : label[1]
    const seconds = session && session.connectedAt ? Math.max(0, Math.floor(((session.endedAt || Date.now()) - session.connectedAt) / 1000)) : 0
    helper.set(this, { stage, mediaType, callId: this.data.isLab && session ? session.id || '' : '', pageTitle: mediaType === 'video' ? '视频通话' : '语音通话', hasRoom: !!(session && session.roomId),
      title: this.data.isLab ? '本机模拟 · ' + (stage === 'connected' ? '连接状态' : label[0].replace(' · 演示', '')) : stage === 'connected' && this.data.isCloud ? '已接通' : label[0], desc: (session && session.reason) || (this.data.isLab ? '请在联调台推进模拟响铃、接听和连接；不采集音视频，也未呼叫硬件。' : stage === 'connected' ? connectedDescription : label[1]),
      muted: !!(session && session.muted), speaker: !!(session && session.speaker), nr: !!(session && session.nr), cameraOff: !!(session && session.cameraOff),
      duration: String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'), active: activeStages.includes(stage), terminal: stage !== 'ready' && !activeStages.includes(stage) })
  },
  refreshSession() {
    if (this.__hidden || this.data.loading || this.data.busy || this.polling) return
    if (!activeStages.includes(this.data.stage)) return
    const version = this.version || 0
    this.polling = true
    api.getCallSession().then((session) => {
      if (version !== (this.version || 0) || this.__hidden) return
      helper.set(this, { error: '' }); this.applySession(session)
    }).catch((err) => { if (version === (this.version || 0)) helper.error(this, err) }).finally(() => { this.polling = false })
  },
  startCall() {
    if (this.data.busy || this.data.loading || activeStages.includes(this.data.stage)) return
    this.version = (this.version || 0) + 1
    if (this.data.isCloud || this.data.isLab) this.applySession({ stage: 'preparing', mediaType: this.data.mediaType })
    return helper.action(this, () => api.startCall(this.data.mediaType), (session) => this.applySession(session)).then(() => {
      if (!this.__hidden && this.data.stage === 'preparing' && this.data.error) this.applySession(null)
    })
  },
  hang() {
    if (this.data.busy && this.data.stage !== 'preparing') return
    this.version = (this.version || 0) + 1
    return helper.action(this, () => api.endCall('家长结束通话'), (session) => this.applySession(session))
  },
  control(e) {
    if (this.data.stage !== 'connected' || this.data.busy) return
    const key = e.currentTarget.dataset.control
    if (['muted', 'speaker', 'nr', 'cameraOff'].indexOf(key) < 0) return
    return helper.action(this, () => api.updateCallControl(key, !this.data[key]), (session) => this.applySession(session))
  },
  openOfficial() {
    if (this.data.busy) return
    return helper.action(this, () => api.openOfficialCall(), () => {})
  }
})
