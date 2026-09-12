const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('./page-utils')
Page({
  data: { item: {}, loading: true, error: '', busy: false },
  onLoad(q) { this.__disposed = false; this.id = q.id || '' },
  onShow() { if (util.guardAuth()) this.load() },
  load() {
    const version = util.beginRequest(this, 'detail')
    util.safeSetData(this, { loading: true, error: '' })
    return api.getAchievement(this.id).then((data) => {
      if (!util.isRequestCurrent(this, 'detail', version)) return
      if (!data) throw new Error('成果记录不存在或无权访问')
      util.safeSetData(this, { item: data, loading: false })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'detail', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  share() {
    const item = this.data.item
    if (!item.id) return
    shared.navigate('/pages/growth/share?targetType=achievement&targetId=' + encodeURIComponent(item.id) + '&childId=' + encodeURIComponent(item.childId || (item.child && item.child.id) || ''))
  },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  onUnload() { util.disposePage(this) }
})
