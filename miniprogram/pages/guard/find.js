const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { stage: 'ready', title: '让 Mini 响铃', desc: '请确认不会打扰身边的人。单次响铃最长 60 秒。', left: 60, busy: false, loading: true, error: '', child: '孩子', endTime: '' },
  onLoad() { helper.init(this) },
  onShow() { helper.show(this); this.reload(); this.timer = setInterval(() => this.refreshSession(), 1000) },
  onHide() { this.clear(); helper.hide(this) },
  onUnload() { this.clear(); helper.unload(this) },
  clear() { if (this.timer) clearInterval(this.timer); this.timer = null; this.version = (this.version || 0) + 1 },
  reload() {
    helper.read(this, 'find', () => Promise.all([api.getLocation(), api.getFindSession()]), ([loc, session]) => {
      helper.set(this, { child: loc.child.shortName || loc.child.name || '孩子' }); this.applySession(session)
    })
  },
  applySession(session) {
    this._session = session
    const stage = session ? session.stage : 'ready'
    const left = session ? Math.min(60, Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000))) : 60
    const labels = { ready: ['让 Mini 响铃', '请确认不会打扰身边的人。单次响铃最长 60 秒。'], ringing: ['设备响铃中 · 演示', '响铃请求已生效，不代表已找到设备。请在附近寻找。'], stopped: ['已停止响铃', (session && session.reason) || '已手动停止本次响铃。'], expired: ['响铃已自动结束', '最长 60 秒已到。如仍未找到，可再次发起查找。'] }
    const text = labels[stage] || ['状态暂不可用', '请重新查询本次响铃结果。']
    helper.set(this, { stage, title: text[0], desc: text[1], left, endTime: session ? helper.time(session.endsAt) : '' })
  },
  refreshSession() {
    if (this.__hidden || this.data.loading || this.data.stage !== 'ringing') return
    if (this._session) {
      const left = Math.min(60, Math.max(0, Math.ceil((this._session.endsAt - Date.now()) / 1000)))
      helper.set(this, { left })
      if (left === 0) helper.set(this, { title: '响铃计时已结束', desc: '正在确认最终状态；查询确认前请勿重复发起。' })
    }
    if (this.data.busy || this.polling) return
    const version = this.version || 0
    this.polling = true
    api.getFindSession().then((session) => {
      if (version !== (this.version || 0) || this.__hidden) return
      helper.set(this, { error: '' }); this.applySession(session)
    }).catch((err) => { if (version === (this.version || 0)) helper.error(this, err) }).finally(() => { this.polling = false })
  },
  async start() {
    if (this.data.busy || this.data.loading || this.data.stage === 'ringing') return
    helper.set(this, { busy: true, error: '' })
    const ok = await util.confirm('确认让 Mini 响铃？', '这是演示模式，不会让真实设备响铃。模拟响铃最长持续 60 秒，可手动停止。')
    if (!ok || this.__hidden || this.__disposed) { helper.set(this, { busy: false }); return }
    return helper.action(this, () => api.startFinding(), (session) => this.applySession(session))
  },
  stop() {
    if (this.data.busy || this.data.stage !== 'ringing') return
    return helper.action(this, () => api.stopFinding('家长手动停止响铃'), (session) => this.applySession(session))
  }
})
