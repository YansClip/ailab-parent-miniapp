const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { id: '', time: '07:20', label: '', repeat: '周一至周五', repeatIndex: 2, enabled: true, synced: true, loading: true, canManage: false, task: null, busy: false, error: '', result: '', saved: false, repeatOptions: ['仅一次', '每天', '周一至周五', '周末'] },
  onLoad(q) { helper.init(this); helper.set(this, { id: q.id || '' }) },
  onShow() { helper.show(this); if (!this._loaded) this.reload(); else helper.verifyContext(this) },
  onHide() { helper.hide(this) },
  onUnload() { helper.unload(this) },
  reload() {
    return helper.read(this, 'alarm', () => Promise.all([this.data.id ? api.getAlarm(this.data.id) : Promise.resolve(null), api.getContext()]), ([alarm, context]) => {
      if (this.data.id && !alarm) throw { message: '闹钟已不存在，请返回列表重新选择。' }
      this._loaded = true
      this._formChildId = context.childId
      helper.set(this, Object.assign({ canManage: context.canManage }, alarm ? { time: alarm.time, label: alarm.label, repeat: alarm.repeat || '仅一次', repeatIndex: Math.max(0, this.data.repeatOptions.indexOf(alarm.repeat)), enabled: !!alarm.enabled, synced: alarm.synced !== false } : {}))
    })
  },
  onTime(e) { helper.set(this, { time: e.detail.value }) },
  onLabel(e) { helper.set(this, { label: e.detail.value }) },
  onRepeat(e) { const i = Number(e.detail.value); helper.set(this, { repeat: this.data.repeatOptions[i] || '仅一次', repeatIndex: i }) },
  toggle() { if (this.data.canManage && !this.data.busy && !this.data.saved) helper.set(this, { enabled: !this.data.enabled }) },
  save() {
    if (this.data.saved) return wx.navigateBack()
    if (!this.data.canManage || this.data.loading || this.data.busy) return
    const label = this.data.label.trim()
    if (!label || label.length > 20) return helper.set(this, { error: '请填写 1 至 20 字的闹钟名称。' })
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(this.data.time)) return helper.set(this, { error: '请选择有效的提醒时间。' })
    const payload = { id: this.data.id, time: this.data.time, label, repeat: this.data.repeat, enabled: this.data.enabled }
    helper.task(this, () => api.submitTask('alarm-save', payload), () => helper.set(this, { saved: true }))
  },
  async del() {
    if (!this.data.canManage || this.data.busy || this.data.saved) return
    if (this._pendingTask) return helper.resume(this)
    helper.set(this, { busy: true })
    const ok = await util.confirm('删除闹钟？', '删除后设备将不再按此规则提醒；离线时需待上线同步。')
    helper.set(this, { busy: false })
    if (!ok || this.__hidden || this.__disposed) return
    helper.task(this, () => api.submitTask('alarm-delete', { id: this.data.id }), () => helper.set(this, { saved: true }))
  },
  checkTask() { helper.resume(this) }
})
