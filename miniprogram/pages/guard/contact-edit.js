const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { id: '', name: '', relation: '', phone: '', deviceCall: true, referenced: false, canManage: false, synced: true, loading: true, busy: false, task: null, error: '', result: '', saved: false },
  onLoad(q) { helper.init(this); helper.set(this, { id: q.id || '' }) },
  onShow() { helper.show(this); if (!this._loaded) this.reload(); else helper.verifyContext(this) },
  onHide() { helper.hide(this) },
  onUnload() { helper.unload(this) },
  reload() {
    return helper.read(this, 'contact', () => Promise.all([this.data.id ? api.getContact(this.data.id) : Promise.resolve(null), api.getSos(), api.getContext()]), ([contact, sos, context]) => {
      if (this.data.id && !contact) throw { message: '联系人已不存在，请返回通讯录重新选择。' }
      this._loaded = true
      this._formChildId = context.childId
      this._originalPhone = contact ? contact.phone : ''
      helper.set(this, Object.assign({ canManage: context.canManage, referenced: sos.some((s) => s.id === this.data.id) }, contact ? { name: contact.name, relation: contact.relation, phone: contact.phone, deviceCall: contact.deviceCall, synced: contact.synced !== false } : {}))
    })
  },
  setName(e) { helper.set(this, { name: e.detail.value }) },
  setRel(e) { helper.set(this, { relation: e.detail.value }) },
  setPhone(e) { helper.set(this, { phone: e.detail.value }) },
  toggle() {
    if (!this.data.canManage || this.data.busy || this.data.saved) return
    if (this.data.referenced && this.data.deviceCall) return util.toast('紧急联系人不可停用，请先从 SOS 中移除')
    helper.set(this, { deviceCall: !this.data.deviceCall })
  },
  save() {
    if (this.data.saved) return wx.navigateBack()
    if (!this.data.canManage || this.data.loading || this.data.busy) return
    const name = this.data.name.trim(), relation = this.data.relation.trim(), phone = this.data.phone.trim()
    if (!name || !relation || !phone) return helper.set(this, { error: '请完整填写姓名、关系和手机号。' })
    if (name.length > 20 || relation.length > 12) return helper.set(this, { error: '姓名最多 20 字，关系最多 12 字。' })
    const unchangedMasked = this.data.id && phone === this._originalPhone && /^1[3-9]\d\*{4}\d{4}$/.test(phone)
    if (!/^1[3-9]\d{9}$/.test(phone) && !unchangedMasked) return helper.set(this, { error: '请输入有效的 11 位手机号；已有脱敏号码仅可原样保留。' })
    const payload = { id: this.data.id, name, relation, phone, deviceCall: this.data.deviceCall }
    helper.task(this, () => api.saveContact(payload), () => helper.set(this, { saved: true }))
  },
  async remove() {
    if (!this.data.canManage || this.data.busy || this.data.saved) return
    if (this.data.referenced) return helper.set(this, { error: '此联系人被 SOS 引用，请先调整紧急联系人，再删除。' })
    if (this._pendingTask) return helper.resume(this)
    helper.set(this, { busy: true })
    const ok = await util.confirm('删除联系人？', '删除后将从当前孩子的设备通讯录移除；离线时需待上线同步。')
    helper.set(this, { busy: false })
    if (!ok || this.__hidden || this.__disposed) return
    helper.task(this, () => api.submitTask('contact-delete', { id: this.data.id }), () => helper.set(this, { saved: true }))
  },
  checkTask() { helper.resume(this) }
})
