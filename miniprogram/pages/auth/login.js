const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  data: { loading: false, next: '', error: '' },
  onLoad(q) { this.setData({ next: q.next || '' }) },
  onLogin() {
    if (this.data.loading) return
    this.setData({ loading: true, error: '' })
    api.login().then(() => {
      if (!util.pageMounted(this)) return
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
    }).catch((e) => { util.failToast(e); util.safeSetData(this, { error: e.message || '登录失败，请重试' }) }).finally(() => util.safeSetData(this, { loading: false }))
  },
  onUnload() { util.disposePage(this) }
})
