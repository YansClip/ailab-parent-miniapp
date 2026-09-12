const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('./page-utils')
Page({
  data: { growth: {}, loading: true, error: '', busy: false },
  onLoad(q) { this.__disposed = false;  },
  onShow() { if (util.guardAuth()) this.load() },
  load() {
    const version = util.beginRequest(this, 'detail')
    util.safeSetData(this, { loading: true, error: '' })
    return api.getGrowth().then((data) => {
      if (!util.isRequestCurrent(this, 'detail', version)) return
      if (!data) throw new Error('探索覆盖记录不存在或无权访问')
      util.safeSetData(this, { growth: data, loading: false })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'detail', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  goDim(e) { shared.navigate('/pages/growth/dimension?key=' + encodeURIComponent(e.currentTarget.dataset.key)) },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  onUnload() { util.disposePage(this) }
})
