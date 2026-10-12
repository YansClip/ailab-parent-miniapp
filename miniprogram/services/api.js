/** Public boundary. Local simulation is replaceable without importing mock in pages. */
const mock = require('./mock')
const store = require('./store')
const device = require('./device/index')
const publicContent = require('./public-content')
function login(options = {}) {
  if (device.isCloud()) {
    const epoch = store.getEpoch()
    return device.getSetup().getIdentity().then(identity => {
      if (store.getEpoch() !== epoch || (options.isCancelled && options.isCancelled()) || !store.getSession().privacyAccepted) throw { code: 'CANCELLED', message: '登录已取消' }
      // Do not grant real family/device permissions from the local sample family.
      store.setSession({ loggedIn: true, identityMode: 'cloud', familyReady: false, familyCreated: false })
      return { ok: true, isDemo: false, appid: identity.appid }
    })
  }
  return new Promise((resolve, reject) => {
    const epoch = store.getEpoch()
    wx.login({
      success(result) {
        if (options.isCancelled && options.isCancelled()) { reject({ code: 'CANCELLED', message: '登录已取消' }); return }
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
  getPublicGuide: () => Promise.resolve(publicContent.getGuide()),
  acceptPrivacy() { store.setSession({ privacyAccepted: true }); return Promise.resolve({ ok: true }) },
  createFamily: (payload) => mock.submitTask('family-create', payload || {}),
  bindChild: (payload) => mock.submitTask('child-bind', payload || {}),
  completeBind: (taskId) => mock.completeBind(taskId)
}
;['getContext', 'getParent', 'getChildren', 'getHome', 'getFootprint', 'toggleFootprintFollow', 'getLocation', 'refreshLocation', 'getContacts', 'getContact', 'saveContact', 'getAlarms', 'getAlarm', 'getSos', 'saveSos', 'getGrowth', 'getGrowthDimension', 'getReport', 'regenerateReport', 'getAchievement', 'getSharePreview', 'getPrivacyRequest', 'getFamily', 'acceptInvite', 'rejectInvite', 'getDevices', 'getMessages', 'markMessageRead', 'getGuide', 'submitTask', 'getTask', 'getCallSession', 'startCall', 'updateCallControl', 'endCall', 'getFindSession', 'startFinding', 'stopFinding', 'setDemoScenario', 'resetDemo', 'injectDemoEvent', 'getSubscription', 'getFeedbacks'].forEach((name) => {
  api[name] = (...args) => mock[name](...args)
})
module.exports = api
// Device integration is scoped to location and audio/video. Other domains remain
// demo-backed until their own SaaS/family integration is delivered.
api.getDeviceMode = () => device.mode()
api.getGuardChildren = () => device.integrated() ? device.getClient().loadTargets() : mock.getChildren()
api.selectGuardDevice = (id) => device.integrated() ? device.getClient().select(id) : Promise.resolve()
api.getLocation = () => device.integrated() ? device.getClient().snapshot() : mock.getLocation()
api.getCallTarget = () => device.integrated() ? device.getClient().status() : mock.getLocation()
api.refreshLocation = () => device.integrated() ? device.getClient().refresh() : mock.refreshLocation()
api.watchLocation = (stop, lease) => device.integrated() ? device.getClient().watch(!!stop, lease) : Promise.resolve(null)
api.getCallSession = () => device.integrated() ? device.getClient().getCall() : mock.getCallSession()
api.startCall = (mediaType) => device.integrated() ? device.getClient().start(mediaType || 'voice') : mock.startCall(mediaType || 'voice')
api.endCall = (reason) => device.integrated() ? device.getClient().cleanup() : mock.endCall(reason)
api.openOfficialCall = () => device.integrated() ? device.getClient().showCall() : Promise.resolve()
api.updateCallControl = (key, value) => device.integrated() ? Promise.reject({ code: 'OFFICIAL_CONTROLS', message: device.isLab() ? '本机模式不采集音视频，不能操作真实媒体控件' : '请在微信官方通话界面中操作' }) : mock.updateCallControl(key, value)
api.getLabInfo = () => ({ ...device.getLab().info(), unavailable: device.getLab().availability(), checks: device.readiness() })
api.pairLab = code => device.getLab().pair(code)
api.disconnectLab = () => device.getLab().disable()
api.getRealIdentity = () => device.getSetup().getIdentity()
api.checkCloudConnection = () => device.getSetup().checkConnection()
api.getCloudBindings = () => device.getSetup().bindings()
api.checkCloudTestLocation = () => require('./device/cloud-location-check').createCloudLocationCheck({ setup: device.getSetup() }).inspect()
api.getVoipReadiness = () => device.getSetup().readiness()
api.getVoipTargets = () => device.getSetup().targets()
api.authorizeDeviceVoip = (scope, remark) => device.getSetup().authorize(scope, remark)
api.syncDeviceVoip = (scope, remark) => device.getSetup().sync(scope, remark)
api.getDeviceVoipStatus = scope => device.getSetup().status(scope)
