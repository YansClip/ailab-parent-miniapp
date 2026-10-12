// Offline only: real domain/relay code, simulated provider, no SDK/network/SQL.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createService, collections: C } = require('../../cloudfunctions/miniDeviceGateway/lib/service')
const { handleCallback } = require('../../cloudfunctions/miniDeviceGateway/lib/callback')
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v))
function memoryRepository() {
  let data = new Map(), queue = Promise.resolve()
  const tx = {
    async get(c, id) { return clone(data.get(c + ':' + id) || null) },
    async put(c, id, v) { data.set(c + ':' + id, clone(v)); return clone(v) },
    async list(c, where) { return [...data.entries()].filter(([k, v]) => k.startsWith(c + ':') && Object.entries(where).every(([f, x]) => v[f] === x)).map(([, v]) => clone(v)) },
    async remove(c, id) { data.delete(c + ':' + id) }
  }
  return { ...tx, async transaction(fn) {
    const job = queue.then(async () => {
      const before = new Map([...data].map(([k, v]) => [k, clone(v)]))
      try { return await fn(tx) } catch (e) { data = before; throw e }
    })
    queue = job.catch(() => {}); return job
  } }
}
async function environment(mediaType = 'voice') {
  let clock = 1800000000000, serial = 0
  const now = () => clock, repo = memoryRepository()
  const config = {
    appid: 'synthetic-app', callbackProtocol: 'ailab-hmac-v1', callbackSecret: crypto.randomBytes(32).toString('hex'),
    locationTtlMs: 60000, statusTtlMs: 30000, watchLeaseMs: 30000, pollMs: 5000,
    refreshTimeoutMs: 10000, callInviteTimeoutMs: 30000, maxCallMs: 600000
  }
  const user = { appid: config.appid, openid: 'synthetic-parent' }
  const scope = { familyId: 'synthetic-family', childId: 'synthetic-child', deviceId: 'synthetic-av-device', bindingVersion: 1 }
  const member = { openid: user.openid, familyId: scope.familyId, childIds: [scope.childId], active: true, consentActive: true, permissions: { viewDevice: true, callDevice: true } }
  await repo.put(C.members, 'synthetic-member', member)
  await repo.put(C.bindings, scope.deviceId, { ...scope, active: true, media: { route: 'cloud-device', sn: scope.deviceId, modelId: 'SYNTHETIC-MODEL', approved: true } })
  const provider = {
    async getDevice() { return { ...scope, online: true, stateTime: now(), capabilities: { voice: true, video: true } } },
    async inviteCall() { throw new Error('Cloud-device route must not send a second invitation') },
    async endCall() { return { confirmed: false } }, async getCall() { return null }
  }
  const service = createService({ repo, provider, config, now })
  const run = (action, p = {}, actor = user) => service.dispatch(action, { scope, ...p }, actor)
  const call = await run('call.prepare', { requestId: 'synthetic-request', mediaType })
  await run('call.attach', { callId: call.id, roomId: 'synthetic-room' })
  const payload = patch => ({ kind: 'call', eventId: 'synthetic-event-' + ++serial, deviceId: scope.deviceId,
    bindingVersion: 1, callId: call.id, roomId: 'synthetic-room', version: serial, state: 'ringing', ...patch })
  const signed = (body, nonce = 'synthetic-nonce-' + ++serial) => {
    const raw = JSON.stringify(body), timestamp = String(now())
    return { httpMethod: 'POST', body: raw, headers: {
      'x-ailab-timestamp': timestamp, 'x-ailab-nonce': nonce,
      'x-ailab-signature': crypto.createHmac('sha256', config.callbackSecret).update(timestamp + '\n' + nonce + '\n' + raw).digest('hex')
    } }
  }
  const receive = request => handleCallback(request, { service, repo, config, now })
  const event = patch => receive(signed(payload(patch)))
  const state = async () => (await repo.get(C.calls, call.id)).state
  return { repo, member, scope, call, run, event, receive, signed, payload, state, advance(ms) { clock += ms } }
}
async function runRehearsal() {
  const results = []
  async function check(id, label, fn) { await fn(); results.push({ id, label, passed: true }) }
  const rejected = (promise, code) => assert.rejects(promise, e => e.code === code)
  await check('voice', '语音：响铃 → 接听且媒体就绪 → 结束', async () => {
    const e = await environment()
    await e.event({ state: 'ringing' }); assert.equal(await e.state(), 'ringing')
    await e.event({ state: 'connected', childAccepted: true, mediaReady: true }); assert.equal(await e.state(), 'connected')
    await e.event({ state: 'ended', endReason: 'device-ended' }); assert.equal(await e.state(), 'ended')
  })
  await check('accept', '未明确接听不能标为通话中', async () => {
    const e = await environment(); await rejected(e.event({ state: 'connected', mediaReady: true }), 'CONSENT_REQUIRED')
    assert.equal(await e.state(), 'calling')
  })
  await check('audio', '仅接听但媒体未就绪不能标为通话中', async () => {
    const e = await environment(); await rejected(e.event({ state: 'connected', childAccepted: true }), 'CONSENT_REQUIRED')
  })
  await check('video', '视频必须另有画面就绪证据', async () => {
    const e = await environment('video')
    await rejected(e.event({ state: 'connected', childAccepted: true, mediaReady: true }), 'CONSENT_REQUIRED')
    await e.event({ state: 'connected', childAccepted: true, mediaReady: true, videoReady: true })
    assert.equal(await e.state(), 'connected')
  })
  await check('signature', '篡改回执签名被拒绝', async () => {
    const e = await environment(), request = e.signed(e.payload({}))
    request.headers['x-ailab-signature'] = '0'.repeat(64)
    await rejected(e.receive(request), 'INVALID_SIGNATURE')
  })
  await check('duplicate', '重复投递幂等，改写同一回执编号被拒绝', async () => {
    const e = await environment(), request = e.signed(e.payload({}), 'synthetic-duplicate')
    await e.receive(request); assert.equal((await e.receive(request)).duplicate, true)
    await rejected(e.receive(e.signed(e.payload({ state: 'ended' }), 'synthetic-duplicate')), 'REPLAY_CONFLICT')
  })
  await check('binding', '旧绑定版本回执被拒绝', async () => {
    const e = await environment(); await rejected(e.event({ bindingVersion: 0 }), 'BINDING_CHANGED')
  })
  await check('room', '其他房间回执被拒绝', async () => {
    const e = await environment(); await rejected(e.event({ roomId: 'synthetic-other-room' }), 'ROOM_CONFLICT')
  })
  await check('order', '乱序回执不会倒退状态', async () => {
    const e = await environment(); await e.event({ state: 'connecting', version: 10 })
    await e.event({ state: 'ringing', version: 9 }); assert.equal(await e.state(), 'connecting')
  })
  await check('hangup', '请求挂断仍待确认，结束回执才结束且不能复活', async () => {
    const e = await environment()
    assert.equal((await e.run('call.end', { callId: e.call.id })).state, 'ending')
    await e.event({ state: 'connected', childAccepted: true, mediaReady: true }); assert.equal(await e.state(), 'ending')
    await e.event({ state: 'ended', endReason: 'parent-ended' }); assert.equal(await e.state(), 'ended')
    await e.event({ state: 'connected', childAccepted: true, mediaReady: true }); assert.equal(await e.state(), 'ended')
  })
  await check('permission', '非授权用户无法读取通话', async () => {
    const e = await environment()
    await rejected(e.run('call.get', { callId: e.call.id }, { appid: 'synthetic-app', openid: 'synthetic-other-parent' }), 'FORBIDDEN')
  })
  await check('expiry', '超时后迟到的接通回执不生效', async () => {
    const e = await environment(); e.advance(31000)
    await e.event({ state: 'connected', childAccepted: true, mediaReady: true }); assert.equal(await e.state(), 'calling')
    assert.equal((await e.run('call.get', { callId: e.call.id })).state, 'ending')
  })
  return { syntheticOnly: true, cloudTouched: false, realMediaVerified: false, passed: results.length, results }
}
function sampleEvent() {
  return { kind: 'call', eventId: 'SYNTHETIC-EVENT-1', deviceId: 'SYNTHETIC-DEVICE', bindingVersion: 1,
    callId: 'SYNTHETIC-CALL', roomId: 'SYNTHETIC-ROOM', version: 1, state: 'connected', childAccepted: true, mediaReady: true, videoReady: true }
}
if (require.main === module) {
  if (process.argv.includes('--example')) console.log(JSON.stringify(sampleEvent(), null, 2))
  else runRehearsal().then(report => {
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2))
    else {
      report.results.forEach(r => console.log('PASS ' + r.label))
      console.log('通过 ' + report.passed + ' 项离线契约演练；未连接云端或硬件，未验证真实声音/画面。')
    }
  }).catch(() => { console.error('离线演练失败，请运行自动测试查看失败断言。'); process.exitCode = 1 })
}
module.exports = { runRehearsal, sampleEvent }
