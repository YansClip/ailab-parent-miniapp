const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { list: [], pick: false, selectedIds: [], count: 0, busy: false, loading: true, error: '', result: '', task: null, canManage: false },
  onLoad(q) { helper.init(this); helper.set(this, { pick: q.pick === 'sos' }) },
  onShow() { helper.show(this); this.reload() },
  onHide() { helper.hide(this) },
  onUnload() { helper.unload(this) },
  reload() {
    return helper.read(this, 'contacts', () => Promise.all([api.getContacts(), api.getSos(), api.getContext()]), ([list, sos, context]) => {
      const selectedIds = this._selectionEdited ? this.data.selectedIds.filter((id) => list.some((c) => c.id === id && c.deviceCall)) : sos.map((s) => s.id)
      helper.set(this, { list: list.map((c) => Object.assign({}, c, { picked: selectedIds.indexOf(c.id) >= 0 })), selectedIds, count: selectedIds.length, canManage: context.canManage })
    })
  },
  add() { if (this.data.canManage && !this.data.busy) wx.navigateTo({ url: '/pages/guard/contact-edit' }) },
  edit(e) {
    if (this.data.busy) return
    if (this.data.pick) return this.toggle(e)
    wx.navigateTo({ url: '/pages/guard/contact-edit?id=' + encodeURIComponent(e.currentTarget.dataset.id) })
  },
  toggle(e) {
    if (!this.data.canManage || this.data.busy) return
    const id = e.currentTarget.dataset.id
    const contact = this.data.list.find((c) => c.id === id)
    if (!contact || !contact.deviceCall) return util.toast('请先在联系人资料中允许设备通话')
    let ids = this.data.selectedIds.slice()
    if (ids.indexOf(id) >= 0) ids = ids.filter((x) => x !== id)
    else {
      if (ids.length >= 3) return util.toast('最多选择 3 名紧急联系人')
      ids.push(id)
    }
    this._selectionEdited = true
    helper.set(this, { selectedIds: ids, count: ids.length, list: this.data.list.map((c) => Object.assign({}, c, { picked: ids.indexOf(c.id) >= 0 })) })
  },
  confirmPick() {
    if (!this.data.canManage || this.data.loading || this.data.busy) return
    if (this.data.selectedIds.length < 1 || this.data.selectedIds.length > 3) return util.toast('请选择 1 至 3 名紧急联系人')
    helper.task(this, () => api.saveSos(this.data.selectedIds.slice()), () => { this._selectionEdited = false; return this.reload() })
  },
  checkTask() { helper.resume(this) }
})
