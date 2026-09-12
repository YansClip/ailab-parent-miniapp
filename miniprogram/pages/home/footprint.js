const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('../growth/page-utils')
Page({
  data: { item: {}, loading: true, error: '', busy: false },
  onLoad(q) { this.__disposed = false; this.id = q.id || '' },
  onShow() { if (util.guardAuth()) { util.safeSetData(this, { busy: false }); this.load() } },
  load() {
    const version = util.beginRequest(this, 'detail')
    util.safeSetData(this, { loading: true, error: '' })
    return api.getFootprint(this.id).then((data) => {
      if (!util.isRequestCurrent(this, 'detail', version)) return
      if (!data) throw new Error('兴趣足迹记录不存在或无权访问')
      util.safeSetData(this, { item: data, loading: false })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'detail', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  toggle() {
    if (this.data.busy || !this.data.item.id) return
    const version = util.beginRequest(this, 'follow')
    util.safeSetData(this, { busy: true })
    api.toggleFootprintFollow(this.data.item.id).then((result) => {
      if (!util.isRequestCurrent(this, 'follow', version)) return
      util.safeSetData(this, { item: Object.assign({}, this.data.item, { followed: result.followed }), busy: false })
      util.toast(result.followed ? '已关注，仅家庭可见' : '已取消关注')
    }).catch((e) => { if (util.isRequestCurrent(this, 'follow', version)) { util.safeSetData(this, { busy: false }); util.failToast(e) } })
  },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  onUnload() { util.disposePage(this) }
})
