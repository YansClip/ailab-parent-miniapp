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
    if (name.length < 2 || name.length > 20 || relation.length < 1 || relation.length > 8) {
      util.toast('家庭名称 2–20 字，称谓 1–8 字')
      return
    }
    this.setData({ loading: true })
    api.createFamily({ name, relation }).then((task) => util.pollTask(task.id, { page: this })).then((result) => {
      if (!util.pageMounted(this) || result.status === 'cancelled') return
      if (result.status === 'success') wx.redirectTo({ url: '/pages/family/bind' })
      else util.toast(result.message || '家庭创建未完成，请重试')
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { loading: false }))
  },
  onUnload() { util.disposePage(this) }
})
