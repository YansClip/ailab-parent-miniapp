const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [], task: null },
  onShow() {
    api.getSos().then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  },
  add() {
    if (this.data.list.length >= 3) {
      util.toast('最多设置 3 名紧急联系人')
      return
    }
    wx.navigateTo({ url: '/pages/guard/contacts?pick=sos' })
  },
  async remove(e) {
    if (this.data.list.length <= 1) {
      util.toast('至少保留 1 名紧急联系人')
      return
    }
    const ok = await util.confirm('移除紧急联系人', '变更将同步至设备，以最终状态为准。')
    if (!ok) return
    const id = e.currentTarget.dataset.id
    const ids = this.data.list.map((x) => x.id).filter((x) => x !== id)
    api.saveSos(ids).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => {
      util.toast(x.message)
      return api.getSos()
    }).then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  }
})
