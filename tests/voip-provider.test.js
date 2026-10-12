const test = require('node:test')
const assert = require('node:assert/strict')
const { createThingConnect, accountKey, ACCOUNTS } = require('../cloudfunctions/miniDeviceGateway/providers/thingconnect')
const { createThingConnectDevice } = require('../cloudfunctions/miniDeviceGateway/providers/thingconnect-device')
const { createVoipAccess, AUTH } = require('../cloudfunctions/miniDeviceGateway/lib/voip-access')
const { fixture } = require('./fixtures/device-integration')
const { httpsJson } = require('../cloudfunctions/miniDeviceGateway/lib/https-json')
const { createService } = require('../cloudfunctions/miniDeviceGateway/lib/service')

async function setup() {
  const f = await fixture(), calls = []
  Object.assign(f.config, { voipProvider: 'thingconnect', thingconnectUserUrl: 'https://users.example.invalid', thingconnectVoipUrl: 'https://voip.example.invalid', providerTimeoutMs: 8000 })
  const b = { ...f.binding, media: { ...f.binding.media, route: 'cloud-device', sn: f.scope.deviceId, accountOpenid: f.user.openid, audioVerified: false, videoVerified: false } }
  await f.repo.put('mini_bindings', b.deviceId, b)
  await f.repo.put(ACCOUNTS, accountKey(f.config.appid, f.user.openid), { openid: f.user.openid, appid: f.config.appid, providerUserId: 'test-account-a', userJwt: 'test-only-jwt', active: true, expiresAt: f.now() + 60000 })
  let remoteAuth = false
  const rows = [{ device_id: b.deviceId, device_name: '测试 Mini', status: 1, online: true,
    profiles: { voip: { has_camera: true, has_screen: true, up_video_mt: 'h264', down_video_mt: 'mjpeg', camera_rotation: 90, down_video_rotation: 1, hor_mirror: false, object_fit: 'contain' } } }]
  let responder = async r => {
    if (r.path === '/v1/user/device/list') return { code: 200, data: rows }
    if (r.path.includes('wechat-mini-login')) return { code: 0, data: { wx_user_openid: f.user.openid } }
    if (r.path.includes('sn-ticket')) return { code: 0, data: { sn_ticket: 'test-only-ticket', device_name: '测试 Mini' } }
    if (r.path.includes('report-auth')) { remoteAuth = true; return { code: 0 } }
    if (r.path.includes('delete-auth')) { remoteAuth = false; return { code: 0 } }
    if (r.path.includes('auth-list')) return { code: 0, data: { list: remoteAuth ? [{ device_id: b.deviceId, auth_status: 'active', authorized_device_name: '测试 Mini' }] : [] } }
    return { code: 0 }
  }
  const provider = createThingConnect({ repo: f.repo, config: f.config, now: f.now, transport: async r => { calls.push(r); return responder(r) } })
  const access = createVoipAccess({ repo: f.repo, service: f.service, config: f.config, provider, now: f.now })
  const run = (a, p = {}, u = f.user) => access.dispatch(a, { scope: f.scope, ...p }, u)
  return { ...f, provider, access, b, calls, rows, run, respond(fn) { responder = fn }, authed() { remoteAuth = true } }
}
test('真实身份：只返回可信上下文本人身份，不要求测试账号；跨 AppID、空身份拒绝', async () => {
  const f = await setup(); f.config.voipProvider = 'disabled'
  const d = await f.run('identity.get', { openid: 'forged', appid: 'forged' })
  assert.equal(d.openid, f.user.openid); assert.equal(d.isDemo, false); assert.equal(f.calls.length, 0)
  await assert.rejects(f.run('identity.get', {}, { ...f.user, appid: 'other' }), { code: 'AUTH_REQUIRED' })
  await assert.rejects(f.run('identity.get', {}, { appid: f.config.appid }), { code: 'AUTH_REQUIRED' })
})
test('探鸽准备：配置缺失、HTTP 地址和账号凭证过期都明确阻断', async () => {
  const f = await setup(); f.config.voipProvider = 'disabled'
  await assert.rejects(f.run('voip.login', { code: 'test-code' }), { code: 'PROVIDER_NOT_CONFIGURED' })
  f.config.voipProvider = 'thingconnect'; f.config.thingconnectUserUrl = 'http://localhost'
  await assert.rejects(f.run('voip.login', { code: 'test-code' }), { code: 'PROVIDER_NOT_CONFIGURED' })
  f.config.thingconnectUserUrl = 'https://users.example.invalid'; f.advance(60001)
  await assert.rejects(f.run('voip.login', { code: 'test-code' }), { code: 'PROVIDER_ACCOUNT_REQUIRED' })
})
test('探鸽身份关联：code 在服务端换取身份，伪造 OpenID 不参与请求；身份不一致阻断', async () => {
  const f = await setup(); await f.run('voip.login', { code: 'code', openid: 'forged' })
  assert.deepEqual(f.calls[0].data, { code: 'code', wx_app_id: f.config.appid })
  f.respond(async () => ({ code: 0, data: { wx_user_openid: 'other-person' } }))
  await assert.rejects(f.run('voip.login', { code: 'code' }), { code: 'OPENID_MISMATCH' })
})
test('多家长隔离：共享探鸽账号被拒绝，不能互相覆盖微信登录关联', async () => {
  const f = await setup()
  await f.repo.put(ACCOUNTS, 'other', { providerUserId: 'test-account-a', appid: f.config.appid, active: true, openid: 'other' })
  await assert.rejects(f.run('voip.login', { code: 'code' }), { code: 'PROVIDER_ACCOUNT_CONFLICT' })
  assert.equal(f.calls.length, 0)
})
test('第三方业务码分开检查，错误响应不泄漏原始服务消息或密钥', async () => {
  const f = await setup(); f.respond(async () => ({ code: 200, msg: 'sensitive-test-key' }))
  await assert.rejects(f.run('voip.login', { code: 'code' }), e => e.code === 'PROVIDER_REJECTED' && !e.message.includes('sensitive'))
})
test('设备列表：只返回本人家庭授权与探鸽绑定交集；不把空 profile 当媒体就绪', async () => {
  const f = await setup(); f.rows.push({ device_id: 'foreign-device', status: 1, online: true })
  const rows = await f.run('voip.targets'); assert.equal(rows.length, 1); assert.equal(rows[0].audioVerified, false)
  assert(!JSON.stringify(rows).includes('test-only-jwt')); assert(!JSON.stringify(rows).includes('mac'))
  f.rows[0].status = 0; assert.deepEqual(await f.run('voip.targets'), [])
})
test('SN 授权：客户端角色和设备名不可信，后台票据名字用于上报且凭证不落业务记录', async () => {
  const f = await setup(), a = await f.run('voip.ticket', { role: 'admin', deviceName: 'forged' })
  assert.equal(a.deviceName, '测试 Mini'); assert.equal(a.sn, f.scope.deviceId)
  const out = await f.run('voip.report', { intentId: a.intentId, authorizationCreated: true, deviceName: 'forged', openid: 'forged', remark: '家长' })
  assert.equal(out.serverAuthorized, true)
  const r = f.calls.find(x => x.path.includes('report-auth'))
  assert.equal(r.data.device_name, '测试 Mini'); assert.equal(r.data.wx_open_id, f.user.openid)
  const records = await f.repo.list(AUTH, {}); assert(!JSON.stringify(records).includes('ticket'))
})
test('授权意图：过期、替换或跨孩子操作不能复用', async () => {
  const f = await setup(), first = await f.run('voip.ticket'), second = await f.run('voip.ticket')
  await assert.rejects(f.run('voip.report', { intentId: first.intentId, authorizationCreated: true }), { code: 'AUTH_INTENT_EXPIRED' })
  await assert.rejects(f.run('voip.report', { scope: { ...f.scope, childId: 'other' }, intentId: second.intentId, authorizationCreated: true }), { code: 'BINDING_CHANGED' })
  f.advance(300001)
  await assert.rejects(f.run('voip.report', { intentId: second.intentId, authorizationCreated: true }), { code: 'AUTH_INTENT_EXPIRED' })
})
test('撤权：在票据请求中撤回家庭授权时，不返回敏感票据', async () => {
  const f = await setup()
  f.respond(async () => {
    await f.repo.put('mini_memberships', 'member-a', { ...f.member, consentActive: false })
    return { code: 0, data: { sn_ticket: 'never-return-this', device_name: '测试 Mini' } }
  })
  await assert.rejects(f.run('voip.ticket'), { code: 'FORBIDDEN' })
  assert.equal((await f.repo.list(AUTH, {})).length, 0)
})
test('准备检查只证明配置存在，不报告平台权限或真实媒体已验证', async () => {
  const f = await setup(), d = await f.run('voip.readiness')
  assert.equal(d.platformPermission, 'unverified'); assert.equal(d.mediaVerified, false); assert.equal(f.calls.length, 0)
  assert(!JSON.stringify(d).includes('test-only-jwt'))
})
test('TiRTC 设备适配：不从视频 profile 推断声音；上行 H264、下行 MJPEG 分开', async () => {
  const f = await setup(), p = createThingConnectDevice({ repo: f.repo, config: f.config, provider: f.provider, now: f.now })
  const d = await p.getDevice(f.scope)
  assert.deepEqual(d.capabilities, { location: false, voice: false, video: false }); assert.equal(d.battery, null)
  await assert.rejects(p.authorizeCall(f.user, f.b), { code: 'CALL_STATE_NOT_CONFIGURED' })
  Object.assign(f.config, { mediaStateRelayReady: true, callbackProtocol: 'ailab-hmac-v1', callbackSecret: 'test-only-relay-secret-that-is-long-enough' }); f.authed()
  const profile = await p.authorizeCall(f.user, f.b)
  assert.equal(profile.enableCallerCamera, true); assert.equal(profile.enableListenerCamera, true)
  assert.equal(profile.videoProfile.encodeVideoRotation, 1)
})
test('TiRTC 云对云：不再发第二份邀请；cancel 成功不等于设备媒体已结束', async () => {
  const f = await setup(), p = createThingConnectDevice({ repo: f.repo, config: f.config, provider: f.provider, now: f.now })
  await p.inviteCall({ route: 'cloud-device' }); assert.equal(f.calls.length, 0)
  const result = await p.endCall({ deviceId: f.scope.deviceId, openid: f.user.openid, roomId: 'test-room' })
  assert.equal(result.confirmed, false); assert.equal(f.calls[0].path, '/v1/voip/user/cancel')
  assert.equal(await p.getCall(), null)
})
test('HTTPS 出站：不允许明文、带身份地址、重定向目标或无效超时', () => {
  for (const baseUrl of ['http://example.invalid', 'https://name:password@example.invalid', 'https://example.invalid/api']) assert.throws(() => httpsJson({ baseUrl, path: '/v1/voip/user/cancel' }), { code: 'PROVIDER_NOT_CONFIGURED' })
  assert.throws(() => httpsJson({ baseUrl: 'https://example.invalid', path: '//other.invalid' }), { code: 'PROVIDER_NOT_CONFIGURED' })
  assert.throws(() => httpsJson({ baseUrl: 'https://example.invalid', path: '/v1/foo', timeoutMs: 0 }), { code: 'CONFIG_REQUIRED' })
})
test('真实通话准备：回执未就绪不创建房间；就绪后使用授权名称且不二次邀请', async () => {
  const f = await setup(); f.authed()
  await f.repo.put('mini_bindings', f.b.deviceId, { ...f.b, media: { ...f.b.media, audioVerified: true, videoVerified: true } })
  const provider = createThingConnectDevice({ repo: f.repo, config: f.config, provider: f.provider, now: f.now })
  const service = createService({ repo: f.repo, config: f.config, provider, now: f.now })
  const prepare = () => service.dispatch('call.prepare', { scope: f.scope, requestId: 'real-test-call', mediaType: 'video' }, f.user)
  await assert.rejects(prepare(), { code: 'CALL_STATE_NOT_CONFIGURED' })
  assert.equal((await f.repo.list('mini_calls', {})).length, 0)
  Object.assign(f.config, { mediaStateRelayReady: true, callbackProtocol: 'ailab-hmac-v1', callbackSecret: 'test-only-relay-secret-that-is-long-enough' })
  const c = await prepare(); assert.equal(c.plugin.deviceName, '测试 Mini'); assert.equal(c.plugin.route, 'cloud-device')
  const count = f.calls.length
  await service.dispatch('call.attach', { scope: f.scope, callId: c.id, roomId: 'real-test-room' }, f.user)
  assert.equal(f.calls.length, count)
  const ending = await service.dispatch('call.end', { callId: c.id }, f.user)
  assert.equal(ending.state, 'ending'); assert(!JSON.stringify(ending).includes('test-only-jwt'))
})
test('真实接通回执：未证实孩子接听和媒体不能接通；完整回执可接通并终结', async () => {
  const f = await setup(); f.authed()
  Object.assign(f.config, { mediaStateRelayReady: true, callbackProtocol: 'ailab-hmac-v1', callbackSecret: 'test-only-relay-secret-that-is-long-enough' })
  await f.repo.put('mini_bindings', f.b.deviceId, { ...f.b, media: { ...f.b.media, audioVerified: true, videoVerified: true } })
  const provider = createThingConnectDevice({ repo: f.repo, config: f.config, provider: f.provider, now: f.now })
  const service = createService({ repo: f.repo, config: f.config, provider, now: f.now })
  const c = await service.dispatch('call.prepare', { scope: f.scope, requestId: 'real-call', mediaType: 'video' }, f.user)
  await service.dispatch('call.attach', { scope: f.scope, callId: c.id, roomId: 'test-room' }, f.user)
  const event = { kind: 'call', eventId: 'connected-1', ...f.scope, callId: c.id, roomId: 'test-room', version: 1, state: 'connected' }
  await assert.rejects(service.deviceEvent(event), { code: 'CONSENT_REQUIRED' })
  assert.equal((await f.repo.get('mini_calls', c.id)).state, 'calling')
  await service.deviceEvent({ ...event, childAccepted: true, mediaReady: true, videoReady: true })
  assert.equal((await f.repo.get('mini_calls', c.id)).state, 'connected')
  await service.deviceEvent({ ...event, eventId: 'ended-2', state: 'ended', version: 2 })
  await service.deviceEvent({ ...event, version: 3, childAccepted: true, mediaReady: true, videoReady: true })
  assert.equal((await f.repo.get('mini_calls', c.id)).state, 'ended')
})
test('撤回通话授权会请求结束本人该设备已有会话，不将通知提交当已挂断', async () => {
  const f = await setup(); f.authed()
  const c = await f.service.dispatch('call.prepare', { scope: f.scope, requestId: 'revoke-call', mediaType: 'voice' }, f.user)
  await f.service.dispatch('call.attach', { scope: f.scope, callId: c.id, roomId: 'test-room' }, f.user)
  f.controls.endConfirmed = false
  const result = await f.run('voip.revoke')
  assert.equal(result.serverAuthorized, false); assert.equal(result.wechatPermissionRemoved, false)
  assert.equal(f.controls.ends.length, 1); assert.equal((await f.repo.get('mini_calls', c.id)).state, 'ending')
})
