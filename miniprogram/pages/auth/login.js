const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  data: { loading: false, next: '' },
  onLoad(q) { this.setData({ next: q.next || '' }) },
  onLogin() {
    if (this.data.loading) return
    this.setData({ loading: true })
    api.login().then(() => {
      const s = store.getSession()
      if (this.data.next === 'join') {
        wx.redirectTo({ url: '/pages/family/bind' })
      } else if (s.familyReady) {
        wx.switchTab({ url: '/pages/home/index' })
      } else if (s.familyCreated) {
        wx.redirectTo({ url: '/pages/family/bind' })
      } else {
        wx.redirectTo({ url: '/pages/family/create' })
      }
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ loading: false }))
  }
})
