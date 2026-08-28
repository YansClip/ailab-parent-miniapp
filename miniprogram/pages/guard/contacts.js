const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { list: [], pick: false, selected: {}, count: 0 },
  onLoad(q) {
    this.setData({ pick: q.pick === 'sos' })
  },
  onShow() {
    this.reload()
  },
  reload() {
    Promise.all([api.getContacts(), api.getSos()]).then(([list, sos]) => {
      const selected = {}
      if (this.data.pick) {
        (sos || []).forEach((s) => { selected[s.id] = true })
      }
      const mapped = (list || []).map((c) => Object.assign({}, c, { picked: !!selected[c.id] }))
      this.setData({
        list: mapped,
        selected,
        count: Object.keys(selected).length
      })
    }).catch((e) => util.failToast(e))
  },
  add() { wx.navigateTo({ url: '/pages/guard/contact-edit' }) },
  edit(e) {
    if (this.data.pick) {
      this.toggle(e)
      return
    }
    wx.navigateTo({ url: '/pages/guard/contact-edit?id=' + e.currentTarget.dataset.id })
  },
  toggle(e) {
    const id = e.currentTarget.dataset.id
    const selected = Object.assign({}, this.data.selected)
    if (selected[id]) {
      delete selected[id]
    } else {
      if (Object.keys(selected).length >= 3) {
        util.toast('最多设置 3 名紧急联系人')
        return
      }
      selected[id] = true
    }
    const list = (this.data.list || []).map((c) => Object.assign({}, c, { picked: !!selected[c.id] }))
    this.setData({ selected, list, count: Object.keys(selected).length })
  },
  confirmPick() {
    const ids = Object.keys(this.data.selected)
    if (ids.length < 1) {
      util.toast('至少选择 1 名紧急联系人')
      return
    }
    if (ids.length > 3) {
      util.toast('最多设置 3 名紧急联系人')
      return
    }
    api.saveSos(ids).then((t) => util.pollTask(t.id)).then((x) => {
      util.toast(x.message)
      wx.navigateBack()
    }).catch((e) => util.failToast(e))
  }
})
