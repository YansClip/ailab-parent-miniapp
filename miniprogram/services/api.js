/** Public boundary. Local simulation is replaceable without importing mock in pages. */
const mock = require('./mock')
const store = require('./store')
function login() {
  return new Promise((resolve, reject) => {
    const epoch = store.getEpoch()
    wx.login({
      success(result) {
        if (store.getEpoch() !== epoch) { reject({ code: 'CANCELLED', message: '登录已取消' }); return }
        if (!result || !result.code) { reject({ code: 'LOGIN_CODE_MISSING', message: '未能取得微信登录凭证，请重试' }); return }
        if (!store.getSession().privacyAccepted) { reject({ code: 'PRIVACY_REQUIRED', message: '请先确认隐私规则' }); return }
        store.setSession({ loggedIn: true })
        resolve({ ok: true, isDemo: true })
      },
      fail() { reject({ code: 'WECHAT_LOGIN_FAILED', message: '微信登录未完成，请检查网络后重试' }) }
    })
  })
}
const api = {
  login,
  acceptPrivacy() { store.setSession({ privacyAccepted: true }); return Promise.resolve({ ok: true }) },
  createFamily: (payload) => mock.submitTask('family-create', payload || {}),
  bindChild: (payload) => mock.submitTask('child-bind', payload || {}),
  completeBind: (taskId) => mock.completeBind(taskId)
}
;['getContext', 'getParent', 'getChildren', 'getHome', 'getFootprint', 'toggleFootprintFollow', 'getLocation', 'refreshLocation', 'getContacts', 'getContact', 'saveContact', 'getAlarms', 'getAlarm', 'getSos', 'saveSos', 'getGrowth', 'getGrowthDimension', 'getReport', 'regenerateReport', 'getAchievement', 'getSharePreview', 'getPrivacyRequest', 'getFamily', 'acceptInvite', 'rejectInvite', 'getDevices', 'getMessages', 'markMessageRead', 'getGuide', 'submitTask', 'getTask', 'getCallSession', 'startCall', 'updateCallControl', 'endCall', 'getFindSession', 'startFinding', 'stopFinding', 'setDemoScenario', 'resetDemo', 'injectDemoEvent', 'getSubscription', 'getFeedbacks'].forEach((name) => {
  api[name] = (...args) => mock[name](...args)
})
module.exports = api
