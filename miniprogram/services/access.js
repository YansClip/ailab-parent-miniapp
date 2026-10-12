// Public browsing never grants consent, creates a session or reads family data.
const store = require('./store')
const tabs = {
  home: '/pages/home/index', guard: '/pages/guard/index',
  growth: '/pages/growth/index', my: '/pages/my/index'
}
function normaliseNext(next) { return next === 'join' || Object.prototype.hasOwnProperty.call(tabs, next) ? next : '' }
function signedIn() { const s = store.getSession(); return s.loggedIn === true && s.privacyAccepted === true }
function familyReady() { return signedIn() && store.getSession().familyReady === true }
function browse(next) { wx.switchTab({ url: tabs[normaliseNext(next)] || tabs.home }) }
function requestLogin(next) {
  const s = store.getSession()
  const target = normaliseNext(next)
  if (signedIn()) {
    if (require('./device/index').isCloud()) { browse(target || 'guard'); return }
    if (target === 'join' || !s.familyReady) wx.navigateTo({ url: s.familyCreated || target === 'join' ? '/pages/family/bind' : '/pages/family/create' })
    else browse(target)
    return
  }
  wx.navigateTo({ url: (s.privacyAccepted ? '/pages/auth/login' : '/pages/auth/privacy') + '?next=' + target })
}
module.exports = { signedIn, familyReady, normaliseNext, browse, requestLogin }
