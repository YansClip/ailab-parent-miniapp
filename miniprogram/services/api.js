/**
 * API 门面。当前走 mock，后续接 SaaS 时只改本文件内部实现。
 */
const mock = require('./mock')
const store = require('./store')

function login() {
  return new Promise((resolve) => {
    wx.login({
      complete() {
        store.setSession({ loggedIn: true, parentName: '陈然', role: '主管理员' })
        resolve({ ok: true, mock: true })
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
  getFamily: () => mock.getFamily(),
  acceptInvite: (id) => mock.acceptInvite(id),
  rejectInvite: (id) => mock.rejectInvite(id),
  getDevices: () => mock.getDevices(),
  getMessages: () => mock.getMessages(),
  getGuide: () => mock.getGuide(),
  submitTask: (type, payload) => mock.submitTask(type, payload),
  getTask: (id) => mock.getTask(id)
}
