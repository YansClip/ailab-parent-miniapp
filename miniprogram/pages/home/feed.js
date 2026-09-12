const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('../growth/page-utils')
Page({
  data: { groups: [], child: {}, loading: true, error: '', selectedType: 'all', filters: [{ key: 'all', name: '全部' }, { key: 'course-completed', name: '探索内容完成' }, { key: 'course-unlocked', name: '探索内容解锁' }, { key: 'question', name: '兴趣提问' }, { key: 'achievement', name: '成果' }] },
  onShow() { this.__disposed = false; if (util.guardAuth()) this.load() },
  load() {
    const version = util.beginRequest(this, 'feed')
    util.safeSetData(this, { loading: true, error: '' })
    return api.getHome().then((home) => {
      if (!util.isRequestCurrent(this, 'feed', version)) return
      this.events = home.dynamics || []
      util.safeSetData(this, { child: home.child, loading: false })
      this.filterEvents()
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'feed', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e) })
    })
  },
  chooseFilter(e) { util.safeSetData(this, { selectedType: e.currentTarget.dataset.type }); this.filterEvents() },
  filterEvents() {
    const type = this.data.selectedType
    util.safeSetData(this, { groups: shared.groupEvents((this.events || []).filter((item) => type === 'all' || item.type === type)) })
  },
  go(e) { shared.navigate(e.currentTarget.dataset.url) },
  onUnload() { util.disposePage(this) }
})
