const api = require('../../services/api')
const helper = require('./helper')
Page({
  data: { list: [], loading: true, busy: false, error: '', result: '', task: null, canManage: false },
  onLoad() { helper.init(this) },
  onShow() { helper.show(this); this.reload() },
  onHide() { helper.hide(this) },
  onUnload() { helper.unload(this) },
  reload() {
    return helper.read(this, 'alarms', () => Promise.all([api.getAlarms(), api.getContext()]), ([list, context]) => helper.set(this, { list, canManage: context.canManage }))
  },
  add() { if (this.data.canManage && !this.data.busy) wx.navigateTo({ url: '/pages/guard/alarm-edit' }) },
  edit(e) { if (!this.data.busy) wx.navigateTo({ url: '/pages/guard/alarm-edit?id=' + encodeURIComponent(e.currentTarget.dataset.id) }) },
  toggle(e) {
    if (!this.data.canManage || this.data.busy) return
    const alarm = this.data.list.find((a) => a.id === e.currentTarget.dataset.id)
    if (!alarm) return
    helper.task(this, () => api.submitTask('alarm-save', { id: alarm.id, time: alarm.time, label: alarm.label, repeat: alarm.repeat, enabled: !alarm.enabled }), () => this.reload())
  },
  checkTask() { helper.resume(this) }
})
