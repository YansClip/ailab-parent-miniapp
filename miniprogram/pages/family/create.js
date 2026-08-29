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
    const name = (this.data.name || '').trim()
    const relation = (this.data.relation || '').trim()
    if (name.length < 2 || relation.length < 1) {
      util.toast('请填写家庭名称和你的称谓')
      return
    }
    this.setData({ loading: true })
    api.createFamily({ name, relation }).then(() => {
      wx.redirectTo({ url: '/pages/family/bind' })
    }).catch((e) => util.failToast(e)).finally(() => this.setData({ loading: false }))
  }
})
