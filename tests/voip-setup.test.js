const test = require('node:test')
const assert = require('node:assert/strict')
const { createDeviceSetup } = require('../miniprogram/services/device/setup')
const { createVoip } = require('../miniprogram/services/device/voip')
const config = { appId: 'wxc5abf3407ed4ef30', envId: 'test-env', functionName: 'gateway', requestTimeoutMs: 100 }
const scope = { familyId: 'test-family', childId: 'test-child', deviceId: 'test-device', bindingVersion: 1 }
const { createWxMock } = require('./helpers')

function setup() {
  let epoch = 1, state = 'authorized', failReport = false, denies = false
  const session = { privacyAccepted: true }, requests = [], writes = [], permissions = [], currentConfig = { ...config }
  let handler = async ({ action, payload }) => {
    if (action === 'identity.get') return { appid: config.appId, openid: 'test-openid', source: 'wx-cloud-context', isDemo: false }
    if (action === 'voip.login') return { linked: true }
    if (action === 'voip.ticket') return { ...scope, sn: scope.deviceId, modelId: 'test-model', deviceName: '后台名称', snTicket: 'test-ticket', intentId: 'test-intent', expiresAt: Date.now() + 300000 }
    if (action === 'voip.status') return { sn: scope.deviceId, modelId: 'test-model', serverAuthorized: true }
    if (action === 'voip.report') { if (failReport) throw { code: 'PROVIDER_TIMEOUT', message: '超时' }; return { serverAuthorized: true } }
    return {}
  }
  const wxApi = {
    getAccountInfoSync: () => ({ miniProgram: { appId: config.appId } }),
    login(o) { o.success({ code: 'fresh-code' }) },
    getDeviceVoIPList(o) { if (state === 'unknown') o.fail({}); else o.success({ list: state === 'missing' ? [] : [{ sn: scope.deviceId, modelId: 'test-model', status: state === 'authorized' ? 1 : 0 }] }) },
    requestDeviceVoIP(o) { permissions.push(o); if (denies) o.fail({ errCode: -1 }); else { state = 'authorized'; o.success({}) } },
    setStorageSync(...args) { writes.push(args) },
    cloud: { init() {}, async callFunction({ data }) {
      requests.push(data)
      try { return { result: { ok: true, data: await handler(data) } } }
      catch (e) { return { result: { ok: false, error: e } } }
    } }
  }
  const store = { getEpoch: () => epoch, getSession: () => session }
  const client = createDeviceSetup({ config: currentConfig, store, wxApi })
  return { client, currentConfig, wxApi, requests, writes, permissions, session,
    state(v) { state = v }, deny(v) { denies = v }, failReport(v) { failReport = v }, handle(fn) { handler = fn }, bump() { epoch++; client.invalidate() } }
}
test('准备客户端：没有企业云配置、隐私同意或 AppID 不同均阻断，不回退演示', async () => {
  const f = setup(); f.currentConfig.envId = ''
  await assert.rejects(f.client.getIdentity(), { code: 'CONFIG_REQUIRED' }); assert.equal(f.requests.length, 0)
  f.currentConfig.envId = 'env'; f.session.privacyAccepted = false
  await assert.rejects(f.client.getIdentity(), { code: 'PRIVACY_REQUIRED' })
  f.session.privacyAccepted = true; f.wxApi.getAccountInfoSync = () => ({ miniProgram: { appId: 'other' } })
  await assert.rejects(f.client.getIdentity(), { code: 'APPID_MISMATCH' })
})
test('OpenID：可信后台本人身份只保存在内存，模拟身份返回不被接受', async () => {
  const f = setup(), d = await f.client.getIdentity()
  assert.equal(d.openid, 'test-openid'); assert.equal(f.writes.length, 0)
  f.handle(async () => ({ appid: config.appId, openid: 'fake', isDemo: true, source: 'mock' }))
  await assert.rejects(f.client.getIdentity(), { code: 'INVALID_IDENTITY' })
})
test('授权按钮：票据名称原样传微信；成功后用新 code 关联后台再 report-auth', async () => {
  const f = setup(); f.state('missing')
  const d = await f.client.authorize(scope, '家长')
  assert.equal(d.ready, true); assert.equal(f.permissions.length, 1)
  assert.equal(f.permissions[0].deviceName, '后台名称'); assert.equal(f.permissions[0].snTicket, 'test-ticket')
  assert.equal(f.requests.filter(x => x.action === 'voip.login').length, 2)
  const report = f.requests.find(x => x.action === 'voip.report')
  assert.equal(report.payload.authorizationCreated, true); assert.equal(report.payload.remark, '家长')
  assert.equal(f.writes.length, 0)
})
test('微信已授权：不重复弹授权框；后台上报 authorizationCreated=false', async () => {
  const f = setup(); await f.client.authorize(scope)
  assert.equal(f.permissions.length, 0)
  assert.equal(f.requests.find(x => x.action === 'voip.report').payload.authorizationCreated, false)
})
test('微信拒绝/已关闭：不写后台成功授权、不发起通话', async () => {
  const f = setup(); f.state('missing'); f.deny(true)
  await assert.rejects(f.client.authorize(scope), { code: 'WX_AUTH_DENIED' })
  assert(!f.requests.some(x => x.action === 'voip.report'))
  f.state('disabled'); await assert.rejects(f.client.authorize(scope), { code: 'WX_AUTH_DISABLED' })
})
test('微信成功、后台同步失败：保留重试意图，同步重试不重新申请票据/通话', async () => {
  const f = setup(); f.state('missing'); f.failReport(true)
  await assert.rejects(f.client.authorize(scope), { code: 'PROVIDER_TIMEOUT' })
  f.failReport(false); const result = await f.client.sync(scope)
  assert.equal(result.ready, true); assert.equal(f.permissions.length, 1)
  assert.equal(f.requests.filter(x => x.action === 'voip.ticket').length, 1)
  assert(!f.requests.some(x => x.action.startsWith('call.')))
})
test('微信状态读取失败是未知，不能当未授权或允许通话', async () => {
  const f = setup(); f.state('unknown')
  const d = await f.client.status(scope); assert.equal(d.wechatState, 'unknown'); assert.equal(d.ready, false)
  await assert.rejects(f.client.ensureCall(scope), { code: 'VOIP_AUTH_REQUIRED' })
})
test('重复点击授权只执行一次；不同设备并行授权明确拒绝', async () => {
  const f = setup(); f.state('missing')
  const a = f.client.authorize(scope), b = f.client.authorize(scope)
  await assert.rejects(f.client.authorize({ ...scope, deviceId: 'other' }), { code: 'AUTH_BUSY' })
  await Promise.all([a, b]); assert.equal(f.permissions.length, 1)
})
test('撤回/退出发生在权限框等待时：迟到回调不报告成功授权', async () => {
  const f = setup(); f.state('missing')
  let complete
  f.wxApi.requestDeviceVoIP = o => { complete = o.success }
  const pending = f.client.authorize(scope)
  while (!complete) await new Promise(r => setImmediate(r))
  f.bump(); f.session.privacyAccepted = false; complete({})
  await assert.rejects(pending, { code: 'STALE_CONTEXT' })
  assert(!f.requests.some(x => x.action === 'voip.report')); assert.equal(f.client.peekIdentity(), null)
})
test('慢身份响应遇到注销/撤权不保存在内存', async () => {
  const f = setup(); let complete
  f.handle(() => new Promise(resolve => { complete = resolve }))
  const pending = f.client.getIdentity(); f.bump()
  complete({ appid: config.appId, openid: 'test-openid', isDemo: false, source: 'wx-cloud-context' })
  await assert.rejects(pending, { code: 'STALE_CONTEXT' }); assert.equal(f.client.peekIdentity(), null)
})
test('微信授权状态慢查询遇到退出时，不返回 ready=true', async () => {
  const f = setup(); let complete
  f.wxApi.getDeviceVoIPList = o => { complete = o.success }
  const pending = f.client.status(scope)
  while (!complete) await new Promise(r => setImmediate(r))
  f.bump(); complete({ list: [{ sn: scope.deviceId, status: 1 }] })
  await assert.rejects(pending, { code: 'STALE_CONTEXT' })
})
test('真实请求超时不无限等待，也不接入模拟账号', async () => {
  const f = setup(); f.currentConfig.requestTimeoutMs = 10; f.handle(() => new Promise(() => {}))
  await assert.rejects(f.client.getIdentity(), { code: 'REQUEST_TIMEOUT' })
  assert.equal(f.client.peekIdentity(), null)
})
test('插件 profile：设备端旋转/镜像与手机预览分开，屏幕比例不冒用设备分辨率', async () => {
  let options, ui
  const p = { callDevice: async d => { options = d; return { roomId: 'test-room' } }, onVoipEvent() {}, forceHangUpVoip() {}, CALL_PAGE_PATH: 'test', setUIConfig(d) { ui = d } }
  const media = createVoip({ settings: { enabled: true }, getPlugin: () => ({ default: p }), getWindowInfo: () => ({ screenWidth: 375, screenHeight: 812 }) })
  await media.create({ id: 'call-1', mediaType: 'video', plugin: { route: 'cloud-device', sn: 'device', modelId: 'model', deviceName: 'Mini', enableCallerCamera: false,
    videoProfile: { cameraRotation: 90, horMirror: true, objectFit: 'contain', encodeVideoRotation: 1 } } })
  assert.equal(options.isCloud, true); assert.equal(options.enableCallerCamera, false); assert.equal(options.encodeVideoRotation, 1)
  assert.equal(ui.callerUI.cameraRotation, 0); assert.equal(ui.listenerUI.cameraRotation, 90)
  assert.equal(ui.listenerUI.aspectRatio, 812 / 375); assert.equal(ui.listenerUI.horMirror, true)
})
test('cloud 登录：后台身份核验后才成功，不沿用模拟家庭授权', async t => {
  const previousWx = global.wx; createWxMock()
  const cfg = require('../miniprogram/config/device'), previousConfig = { mode: cfg.mode, envId: cfg.envId, transport: cfg.transport }
  const store = require('../miniprogram/services/store'), api = require('../miniprogram/services/api')
  t.after(() => { Object.assign(cfg, previousConfig); global.wx = previousWx })
  Object.assign(cfg, { mode: 'cloud', transport: 'function', envId: 'test-only-env' }); store.init()
  store.setSession({ loggedIn: false, privacyAccepted: true, familyReady: true, familyCreated: true })
  wx.cloud = { init() {}, async callFunction() { return { result: { ok: true, data: { appid: cfg.appId, openid: 'test-cloud-openid', isDemo: false, source: 'wx-cloud-context' } } } } }
  const r = await api.login(); assert.equal(r.isDemo, false); assert.equal(store.getSession().loggedIn, true)
  assert.equal(store.getSession().familyReady, false); assert.equal(store.getSession().identityMode, 'cloud')
  assert(!JSON.stringify(wx.getStorageSync('ailab.session.v1')).includes('test-cloud-openid'))
  store.setSession({ loggedIn: false })
  wx.cloud.callFunction = async () => ({ result: { ok: false, error: { code: 'AUTH_REQUIRED', message: '身份不可用' } } })
  await assert.rejects(api.login(), { code: 'AUTH_REQUIRED' }); assert.equal(store.getSession().loggedIn, false)
})
