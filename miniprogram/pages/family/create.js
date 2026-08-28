const api = require('../../services/api')
const util = require('../../utils/util')
const store = require('../../services/store')

Page({
  data: { name: '林小满的家庭', relation: '妈妈', loading: false },
  onLoad() {
    const s = store.getSession()
    if (s.familyName) this.setData({ name: s.familyName, relation: s.relation || '妈妈' })
  },
  onName(e) { this.setData({ name: e.detail.value }) },
  onRel(e) { this.setData({ relation: e.detail.value }) },
  goBind() { wx.navigateTo({ url: '/pages/family/bind' }) },
  onCreate() {
    if (this.data.loading) return
    this.setData({ loading: true })
    api.createFamily({ name: this.data.name, relation: this.data.relation }).then(() => {
      wx.redirectTo({ url: '/pages/family/bind' })
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ loading: false }))
  }
})
