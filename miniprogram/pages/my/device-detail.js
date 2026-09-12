const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { dev: {}, loading: true, error: '', confirm: false, task: null, busy: false, isAdmin: false, removed: false },
  onLoad(q) { this.deviceId = q.id || '' },
  onShow() { this.reload() },
  reload() {
    return helper.load(this, () => Promise.all([api.getDevices(), api.getParent()]), ([list, p]) => {
      const dev = list.find((d) => d.id === this.deviceId)
      if (!dev) throw { message: '该设备已解绑或你没有查看权限，请返回设备中心。' }
      return { dev, isAdmin: p.role === '主管理员' }
    })
  },
  unbind() { if (this.data.isAdmin) this.setData({ confirm: true }); else util.toast('仅主管理员可解绑设备') },
  close() { if (!this.data.busy) this.setData({ confirm: false }) },
  noop() {},
  back() { util.navigate('/pages/my/device') },
  async ok() {
    if (this.data.busy) return
    this.setData({ confirm: false })
    await helper.task(this, 'device-unbind', { id: this.data.dev.id }, () => util.safeSetData(this, { removed: true, dev: {} }))
  },
  onUnload() { util.disposePage(this) }
})
