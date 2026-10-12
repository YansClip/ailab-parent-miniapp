const api = require('../../services/api')
const access = require('../../services/access')
const util = require('../../utils/util')
const store = require('../../services/store')
const shared = require('../growth/page-utils')
const curiosity = require('./curiosity-cards')
const emptyHome = () => ({ child: {}, summary: {}, hero: {}, dynamics: [], footprints: [], achievements: [], todos: [] })
Page({
  data: { guest: true, signedIn: false, statusBarHeight: 44, loading: true, home: emptyHome(), parent: {}, session: {}, children: [], showSwitcher: false, error: '', groups: [], remainingCards: 0, cardsExpanded: false },
  onShow() {
    this.__disposed = false
    util.setTab(0)
    if (!access.familyReady()) {
      this._curiosityCards = []
      util.safeSetData(this, { guest: true, signedIn: access.signedIn(), statusBarHeight: util.statusBarHeight(), loading: false, home: emptyHome(), parent: {}, session: {}, children: [], groups: [], remainingCards: 0, cardsExpanded: false, showSwitcher: false, error: '' })
      return
    }
    util.safeSetData(this, { guest: false, signedIn: true })
    util.safeSetData(this, { statusBarHeight: util.statusBarHeight(), session: store.getSession() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'home')
    util.safeSetData(this, { loading: true, error: '' })
    return Promise.all([api.getHome(), api.getParent(), api.getChildren()]).then(([home, parent, children]) => {
      if (!util.isRequestCurrent(this, 'home', version)) return
      this._curiosityCards = curiosity.buildCuriosityCards(home)
      const visible = this.data.cardsExpanded ? this._curiosityCards : this._curiosityCards.slice(0, 5)
      util.safeSetData(this, { home, parent, children, session: store.getSession(), groups: curiosity.groupCards(visible), remainingCards: this._curiosityCards.length - visible.length, loading: false })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'home', version)) return
      util.safeSetData(this, { loading: false, error: e.message || '首页暂时无法加载' })
    })
  },
  openSwitcher() { util.safeSetData(this, { showSwitcher: true }) },
  closeSwitcher() { util.safeSetData(this, { showSwitcher: false }) },
  onChildChange() {
    this._curiosityCards = []
    util.safeSetData(this, { home: emptyHome(), groups: [], remainingCards: 0, cardsExpanded: false, showSwitcher: false })
    this.reload()
  },
  goFootprint(e) { shared.navigate('/pages/home/footprint?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  goFeed() { shared.navigate('/pages/home/feed') },
  goAch(e) { shared.navigate('/pages/growth/achievement?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  goUrl(e) { shared.navigate(e.currentTarget.dataset.url) },
  expandCards() {
    util.safeSetData(this, { cardsExpanded: true, remainingCards: 0, groups: curiosity.groupCards(this._curiosityCards || []) })
  },
  showTodos() { util.safeSetData(this, { scrollTarget: '' }, () => util.safeSetData(this, { scrollTarget: 'home-todos' })) },
  onUnload() { util.disposePage(this) }
})
