const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { list: [], loading: true, busy: false, canManage: false, error: '', result: '', task: null },
  onLoad() { helper.init(this) },
  onShow() { helper.show(this); this.reload() },
  onHide() { helper.hide(this) },
  onUnload() { helper.unload(this) },
  reload() {
    return helper.read(this, 'sos', () => Promise.all([api.getSos(), api.getContext()]), ([list, context]) => helper.set(this, { list, canManage: context.canManage }))
  },
  add() { if (this.data.canManage && !this.data.busy) wx.navigateTo({ url: '/pages/guard/contacts?pick=sos' }) },
  move(e) {
    if (!this.data.canManage || this.data.busy) return
    const index = Number(e.currentTarget.dataset.index)
    const direction = Number(e.currentTarget.dataset.direction)
    const next = index + direction
    const ids = this.data.list.map((item) => item.id)
    if (next < 0 || next >= ids.length) return
    const old = ids[index]; ids[index] = ids[next]; ids[next] = old
    helper.task(this, () => api.saveSos(ids), () => this.reload())
  },
  async remove(e) {
    if (!this.data.canManage || this.data.busy) return
    if (this.data.list.length <= 1) return helper.set(this, { error: '至少保留 1 名紧急联系人。可通过“调整名单”先替换联系人。' })
    if (this._pendingTask) return helper.resume(this)
    const id = e.currentTarget.dataset.id
    helper.set(this, { busy: true })
    const ok = await util.confirm('移除紧急联系人？', '仅从紧急呼叫顺序中移除，不会删除通讯录联系人。')
    helper.set(this, { busy: false })
    if (!ok || this.__hidden || this.__disposed) return
    const ids = this.data.list.map((item) => item.id).filter((x) => x !== id)
    helper.task(this, () => api.saveSos(ids), () => this.reload())
  },
  checkTask() { helper.resume(this) }
})
