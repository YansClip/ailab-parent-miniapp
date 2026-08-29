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
    const name = (this.data.name || '').trim()
    const relation = (this.data.relation || '').trim()
    const phone = (this.data.phone || '').trim()
    if (!name || !relation || !phone) {
      util.toast('请完整填写姓名、关系和手机号')
      return
    }
    if (!/^1\d{10}$/.test(phone) && !/^1\d{2}\*{4}\d{4}$/.test(phone)) {
      util.toast('手机号格式不正确')
      return
    }
    this.setData({ busy: true })
    api.saveContact(this.data).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => {
      util.toast(x.message)
      if (x.status === 'success') setTimeout(() => wx.navigateBack(), 500)
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  },
  async remove() {
    const ok = await util.confirm('删除联系人', '删除前将检查是否被紧急联系人引用。')
    if (!ok) return
    api.getSos().then((list) => {
      if ((list || []).some((item) => item.id === this.data.id)) {
        util.toast('请先从紧急联系人中移除')
        return null
      }
      return util.runTask(this, 'contact-delete', { id: this.data.id })
    }).then((x) => {
      if (x && x.status === 'success') wx.navigateBack()
    }).catch((e) => util.failToast(e))
  }
})
