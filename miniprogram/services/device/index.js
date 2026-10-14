const config = require('../../config/device')
const store = require('../store')
const { createDeviceClient } = require('./client')
const { createVoip } = require('./voip')
const { createLabClient } = require('./lab')
const { createDeviceSetup } = require('./setup')
const { connection } = require('./transport')
let client
let lab
let setup
function getSetup() {
  if (!setup) {
    setup = createDeviceSetup({ config, store, wxApi: wx })
    store.on((type, value) => {
      if (['logout', 'reset'].includes(type) || (type === 'session' && (!value.loggedIn || !value.privacyAccepted))) setup.invalidate()
    })
  }
  return setup
}
function getLab() {
  if (!lab) {
    lab = createLabClient({ wxApi: wx, store })
    store.on((type, value) => {
      if (['logout', 'reset'].includes(type) || (type === 'session' && (!value.loggedIn || !value.privacyAccepted))) lab.invalidate()
    })
  }
  return lab
}
function getClient() {
  if (lab && lab.isEnabled()) return lab
  if (!client) {
    const media = createVoip({ settings: config.voip, getPlugin: name => requirePlugin(name), getWindowInfo: () => wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(), navigate: url => new Promise((resolve,reject) => wx.navigateTo({ url, success: resolve, fail: reject })) })
    client = createDeviceClient({ config, store, wxApi: wx, media, authorizeCall: scope => getSetup().ensureCall(scope) })
    store.on((type, value) => {
      if (['logout', 'reset'].includes(type) || (type === 'session' && (!value.loggedIn || !value.privacyAccepted))) client.invalidate()
    })
  }
  return client
}
module.exports = { isCloud: () => config.mode === 'cloud', isLab: () => Boolean(lab && lab.isEnabled()), getClient, getLab, getSetup,
  mode: () => lab && lab.isEnabled() ? 'lab' : config.mode,
  integrated: () => config.mode === 'cloud' || Boolean(lab && lab.isEnabled()),
  readiness() {
    let configured = false
    try { connection(config); configured = true } catch (_) { /* Pending deployment is not success. */ }
    const checks = [
      { label: config.transport === 'cloudrun' ? '微信云托管设备后台' : 'CloudBase 测试环境', ready: configured, detail: configured ? '调用参数已配置；仍需验证部署、可信身份和权限' : '已备接入代码，设备业务服务尚未部署启用；Django 模板不是设备后台' },
      { label: '微信通话插件开关', ready: config.voip.enabled === true, detail: config.voip.enabled ? '已启用；不代表平台授权通过' : '未启用，不发起真实呼叫' },
      { label: '微信官方 RTOS 云对云方案', ready: false, detail: 'P4+C5 已确认；SDK 编译、平台型号及音视频许可仍待验证' },
      { label: '官方信令与媒体通道', ready: false, detail: '当前仅可本地演练；可信回调、服务端 SDK 运行及真实双向音画尚未接通' }
    ]
    return checks
  }
}
