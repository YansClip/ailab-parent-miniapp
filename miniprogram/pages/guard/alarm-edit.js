const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: {
    id: '', time: '07:20', label: '起床', repeat: '周一至周五', enabled: true, task: null, busy: false,
    repeatOptions: ['仅一次', '每天', '周一至周五', '周末']
  },
  onLoad(q) {
    const id = q.id || ''
    this.setData({ id })
    if (!id) return
    api.getAlarm(id).then((a) => {
      if (!a) return
      this.setData({ time: a.time, label: a.label, repeat: a.repeat || '仅一次', enabled: !!a.enabled })
    }).catch((e) => util.failToast(e))
  },
  onTime(e) { this.setData({ time: e.detail.value }) },
  onLabel(e) { this.setData({ label: e.detail.value }) },
  onRepeat(e) { this.setData({ repeat: this.data.repeatOptions[Number(e.detail.value)] || '仅一次' }) },
  toggle() { this.setData({ enabled: !this.data.enabled }) },
  save() {
    if (this.data.busy) return
    if (!(this.data.label || '').trim()) {
      util.toast('请填写闹钟名称')
      return
    }
    this.setData({ busy: true })
    api.submitTask('alarm-save', this.data).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => {
      util.toast(x.message)
      if (x.status === 'success') setTimeout(() => wx.navigateBack(), 500)
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  },
  async del() {
    const ok = await util.confirm('删除闹钟', '删除后设备将不再在该时间响铃。')
    if (!ok) return
    util.runTask(this, 'alarm-delete', { id: this.data.id }).then((x) => {
      if (x && x.status === 'success') wx.navigateBack()
    })
  }
})
