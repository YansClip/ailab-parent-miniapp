const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('./page-utils')
Page({
  data: { dim: {}, loading: true, error: '', busy: false },
  onLoad(q) { this.__disposed = false; this.key = q.key || '' },
  onShow() { if (util.guardAuth()) this.load() },
  load() {
    const version = util.beginRequest(this, 'detail')
    util.safeSetData(this, { loading: true, error: '' })
    return api.getGrowthDimension(this.key).then((data) => {
      if (!util.isRequestCurrent(this, 'detail', version)) return
      if (!data) throw new Error('维度记录不存在或无权访问')
      data.relatedLessons = (data.relatedLessons || []).map((lesson) => Object.assign({}, lesson, { statusText: lesson.completed || lesson.status === 'completed' ? '已完成' : lesson.status === 'available' ? '已解锁' : '未完成' }))
      util.safeSetData(this, { dim: data, loading: false })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'detail', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  onUnload() { util.disposePage(this) }
})
