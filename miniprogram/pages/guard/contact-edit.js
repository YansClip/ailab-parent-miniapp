const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { id: '', name: '', relation: '', phone: '', deviceCall: true, task: null, busy: false },
  onLoad(q) {
    const id = q.id || ''
    this.setData({ id })
    if (!id) return
    api.getContact(id).then((c) => {
      if (!c) return
      this.setData({
        name: c.name,
        relation: c.relation,
        phone: c.phone,
        deviceCall: !!c.deviceCall
      })
    }).catch((e) => util.failToast(e))
  },
  setName(e) { this.setData({ name: e.detail.value }) },
  setRel(e) { this.setData({ relation: e.detail.value }) },
  setPhone(e) { this.setData({ phone: e.detail.value }) },
  toggle() { this.setData({ deviceCall: !this.data.deviceCall }) },
  save() {
    if (this.data.busy) return
    this.setData({ busy: true })
    api.saveContact(this.data).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => {
      util.toast(x.message)
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ busy: false }))
  },
  async remove() {
    const ok = await util.confirm('删除联系人', '删除前将检查是否被紧急联系人引用。')
    if (!ok) return
    util.runTask(this, 'contact-delete', { id: this.data.id }).then(() => wx.navigateBack())
  }
})
