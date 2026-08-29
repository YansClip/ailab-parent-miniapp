/**
 * API 门面。当前走 mock，后续接 SaaS 时只改本文件内部实现。
 */
const mock = require('./mock')
const store = require('./store')

function login() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (!result || !result.code) {
          reject({ code: 'LOGIN_CODE_MISSING', message: '未能取得微信登录凭证，请重试' })
          return
        }
        store.setSession({ loggedIn: true, parentName: '陈然', role: '主管理员' })
        resolve({ ok: true })
      },
      fail(error) {
        reject({
          code: 'WECHAT_LOGIN_FAILED',
          message: (error && error.errMsg) ? '微信登录未完成，请检查网络后重试' : '微信登录失败，请重试'
        })
      }
    })
  })
}

module.exports = {
  login,
  acceptPrivacy() {
    store.setSession({ privacyAccepted: true })
    return Promise.resolve({ ok: true })
  },
  createFamily(payload) {
    store.setSession({
      familyCreated: true,
      familyName: (payload && payload.name) || '林小满的家庭',
      relation: (payload && payload.relation) || '妈妈'
    })
    return mock.submitTask('family-create', payload || {})
  },
  bindChild(payload) {
    return mock.submitTask('child-bind', payload || {})
  },
  completeBind() {
    store.setSession({ familyReady: true })
    return Promise.resolve({ ok: true })
  },
  getParent: () => mock.getParent(),
  getChildren: () => mock.getChildren(),
  getHome: () => mock.getHome(),
  getFootprint: (id) => mock.getFootprint(id),
  getLocation: () => mock.getLocation(),
  refreshLocation: () => mock.refreshLocation(),
  getContacts: () => mock.getContacts(),
  getContact: (id) => mock.getContact(id),
  saveContact: (p) => mock.saveContact(p),
  getAlarms: () => mock.getAlarms(),
  getAlarm: (id) => mock.getAlarm(id),
  getSos: () => mock.getSos(),
  saveSos: (ids) => mock.saveSos(ids),
  getGrowth: () => mock.getGrowth(),
  getReport: (id) => mock.getReport(id),
  regenerateReport: (id) => mock.regenerateReport(id),
  getAchievement: (id) => mock.getAchievement(id),
  getSharePreview: (id) => mock.getSharePreview(id),
  getPrivacyRequest: (type) => mock.getPrivacyRequest(type),
  getFamily: () => mock.getFamily(),
  acceptInvite: (id) => mock.acceptInvite(id),
  rejectInvite: (id) => mock.rejectInvite(id),
  getDevices: () => mock.getDevices(),
  getMessages: () => mock.getMessages(),
  markMessageRead: (id) => mock.markMessageRead(id),
  getGuide: () => mock.getGuide(),
  submitTask: (type, payload) => mock.submitTask(type, payload),
  getTask: (id) => mock.getTask(id)
}
