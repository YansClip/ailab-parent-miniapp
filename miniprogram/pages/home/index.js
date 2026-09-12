const api = require('../../services/api')
const util = require('../../utils/util')
const store = require('../../services/store')
const shared = require('../growth/page-utils')
const emptyHome = () => ({ child: {}, summary: {}, hero: {}, dynamics: [], footprints: [], achievements: [], todos: [] })
Page({
  data: { statusBarHeight: 44, loading: true, home: emptyHome(), parent: {}, session: {}, children: [], showSwitcher: false, error: '', groups: [] },
  onShow() {
    this.__disposed = false
    util.setTab(0)
    if (!util.guardAuth()) return
    util.safeSetData(this, { statusBarHeight: util.statusBarHeight(), session: store.getSession() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'home')
    util.safeSetData(this, { loading: true, error: '' })
    return Promise.all([api.getHome(), api.getParent(), api.getChildren()]).then(([home, parent, children]) => {
      if (!util.isRequestCurrent(this, 'home', version)) return
      util.safeSetData(this, { home, parent, children, session: store.getSession(), groups: shared.groupEvents((home.dynamics || []).slice(0, 4)), loading: false })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'home', version)) return
      util.safeSetData(this, { loading: false, error: e.message || '首页暂时无法加载' })
    })
  },
  openSwitcher() { util.safeSetData(this, { showSwitcher: true }) },
  closeSwitcher() { util.safeSetData(this, { showSwitcher: false }) },
  onChildChange() {
    util.safeSetData(this, { home: emptyHome(), groups: [], showSwitcher: false })
    this.reload()
  },
  goFootprint(e) { shared.navigate('/pages/home/footprint?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  goFeed() { shared.navigate('/pages/home/feed') },
  goAch(e) { shared.navigate('/pages/growth/achievement?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  goUrl(e) { shared.navigate(e.currentTarget.dataset.url) },
  showTodos() { util.safeSetData(this, { scrollTarget: '' }, () => util.safeSetData(this, { scrollTarget: 'home-todos' })) },
  onUnload() { util.disposePage(this) }
})
