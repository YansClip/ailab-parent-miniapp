const api = require('../../services/api')
const util = require('../../utils/util')

Page({
  data: { next: '', busy: false },
  onLoad(q) {
    this.setData({ next: q.next || '' })
  },
  openPolicy(e) {
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: '/pages/my/policy?type=' + type })
  },
  onAgree() {
    if (this.data.busy) return
    this.setData({ busy: true })
    api.acceptPrivacy().then(() => {
      if (!util.pageMounted(this)) return
      wx.navigateTo({ url: '/pages/auth/login?next=' + (this.data.next || '') })
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  },
  onDecline() {
    wx.navigateTo({ url: '/pages/auth/declined' })
  },
  onUnload() { util.disposePage(this) }
})
