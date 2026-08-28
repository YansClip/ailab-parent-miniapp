const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { family: { members: [] }, busy: false, task: null },
  onShow() { this.reload() },
  reload() {
    api.getFamily().then((family) => this.setData({ family })).catch((e) => util.failToast(e))
  },
  goChild() { wx.navigateTo({ url: '/pages/my/child' }) },
  goTransfer() { wx.navigateTo({ url: '/pages/my/transfer' }) },
  accept(e) {
    if (this.data.busy) return
    this.setData({ busy: true })
    api.acceptInvite(e.currentTarget.dataset.id).then((t) => util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })).then((x) => {
      util.toast(x.message)
      this.reload()
    }).catch((err) => util.failToast(err)).finally(() => this.setData({ busy: false }))
  },
  async reject(e) {
    const ok = await util.confirm('拒绝邀请', '拒绝后对方需重新申请加入家庭。')
    if (!ok) return
    if (this.data.busy) return
    this.setData({ busy: true })
    api.rejectInvite(e.currentTarget.dataset.id).then((t) => util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })).then((x) => {
      util.toast(x.message)
      this.reload()
    }).catch((err) => util.failToast(err)).finally(() => this.setData({ busy: false }))
  }
})
