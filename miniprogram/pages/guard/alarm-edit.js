const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { id: '', time: '07:20', label: '起床', enabled: true, task: null, busy: false },
  onLoad(q) {
    const id = q.id || ''
    this.setData({ id })
    if (!id) return
    api.getAlarm(id).then((a) => {
      if (!a) return
      this.setData({ time: a.time, label: a.label, enabled: !!a.enabled })
    }).catch((e) => util.failToast(e))
  },
  onTime(e) { this.setData({ time: e.detail.value }) },
  onLabel(e) { this.setData({ label: e.detail.value }) },
  toggle() { this.setData({ enabled: !this.data.enabled }) },
  save() {
    if (this.data.busy) return
    this.setData({ busy: true })
    api.submitTask('alarm-save', this.data).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => util.toast(x.message)).catch((e) => util.failToast(e)).finally(() => this.setData({ busy: false }))
  },
  async del() {
    const ok = await util.confirm('删除闹钟', '删除后设备将不再在该时间响铃。')
    if (!ok) return
    util.runTask(this, 'alarm-delete', { id: this.data.id }).then(() => wx.navigateBack())
  }
})
