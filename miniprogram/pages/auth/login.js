const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')
const access = require('../../services/access')

Page({
  data: { loading: false, next: '', error: '', isCloud: false },
  onLoad(q) { this.__disposed = false; this.setData({ next: access.normaliseNext(q.next), isCloud: api.getDeviceMode() === 'cloud' }) },
  onLogin() {
    if (this.data.loading) return
    if (!store.getSession().privacyAccepted) { access.requestLogin(this.data.next); return }
    const attempt = (this._loginVersion || 0) + 1
    this._loginVersion = attempt
    this.setData({ loading: true, error: '' })
    api.login({ isCancelled: () => this._loginVersion !== attempt || !util.pageMounted(this) }).then(() => {
      if (this._loginVersion !== attempt || !util.pageMounted(this)) return
      const s = store.getSession()
      if (this.data.isCloud) { access.browse(this.data.next || 'guard'); return }
      if (this.data.next === 'join') {
        wx.redirectTo({ url: '/pages/family/bind' })
      } else if (s.familyReady) {
        access.browse(this.data.next)
      } else if (s.familyCreated) {
        wx.redirectTo({ url: '/pages/family/bind' })
      } else {
        wx.redirectTo({ url: '/pages/family/create' })
      }
    }).catch((e) => {
      if (this._loginVersion !== attempt || !util.pageMounted(this)) return
      util.failToast(e); util.safeSetData(this, { error: e.message || '登录失败，请重试' })
    }).finally(() => { if (this._loginVersion === attempt) util.safeSetData(this, { loading: false }) })
  },
  skip() { this._loginVersion = (this._loginVersion || 0) + 1; access.browse(this.data.next) },
  onUnload() { this._loginVersion = (this._loginVersion || 0) + 1; util.disposePage(this) }
})
