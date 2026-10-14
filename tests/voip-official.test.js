const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createCall, applyEvent, checkPolicy } = require('../miniprogram/services/device/official-call-machine')
const { createRehearsal } = require('../miniprogram/services/device/official-rehearsal')
const { buildCloudCallRequest, incomingReminderState } = require('../miniprogram/services/device/official-contract')
const { createSimulation } = require('../tools/wechat-official-voip/simulation')
const { createRuntime } = require('../server/mini-device-cloudrun/runtime')
const { readConfig } = require('../server/mini-device-cloudrun/config')
const { fixture } = require('./fixtures/device-integration')
const make = (direction = 'phone-to-device') => createCall({ id: 'synthetic-call', direction, mediaType: 'voice', now: 0 })
const step = (call, type, actor, now = 1) => applyEvent(call, { callId: call.id, type, actor }, now)
const policy = { bound: true, online: true, callAllowed: true, incomingReminder: 'missing' }
for (const direction of ['phone-to-device', 'device-to-phone']) test(`官方业务模型：${direction} 主动接听后才模拟连接且从不采集`, () => {
  const receiver = direction === 'phone-to-device' ? 'device' : 'phone'
  let c = make(direction)
  assert.throws(() => step(c, 'joined'), { code: 'INVALID_TRANSITION' })
  c = step(c, 'notify'); assert.equal(step(c, 'notify'), c)
  assert.throws(() => step(c, 'accept', receiver === 'phone' ? 'device' : 'phone'), { code: 'WRONG_ACTOR' })
  assert.throws(() => step(c, 'reject', receiver === 'phone' ? 'device' : 'phone'), { code: 'WRONG_ACTOR' })
  c = step(c, 'accept', receiver); assert.equal(c.state, 'joining'); assert.equal(step(c, 'accept', receiver), c)
  assert.throws(() => step(c, 'cancel', receiver === 'phone' ? 'device' : 'phone'), { code: 'INVALID_TRANSITION' })
  c = step(c, 'joined'); assert.equal(c.state, 'connected'); assert.equal(step(c, 'joined'), c)
  assert.equal(c.captureAllowed, false); assert.equal(c.mediaVerified, false); assert.equal(c.recordingAllowed, false)
  c = step(c, 'hangup', receiver); assert.equal(c.state, 'ended')
  assert.equal(step(c, 'joined'), c)
})
test('官方业务模型：呼入提醒不阻止手机呼出，但业务权限永远需要', () => {
  checkPolicy(policy, 'phone-to-device')
  assert.throws(() => checkPolicy(policy, 'device-to-phone'), { code: 'REMINDER_REQUIRED' })
  checkPolicy({ ...policy, incomingReminder: 'authorized' }, 'device-to-phone')
  for (const [key, code] of [['bound', 'BINDING_CHANGED'], ['online', 'DEVICE_OFFLINE'], ['callAllowed', 'FORBIDDEN']]) {
    assert.throws(() => checkPolicy({ ...policy, [key]: false }, 'phone-to-device'), { code })
  }
})
test('官方业务模型：超时优先于迟到接听，终态不可复活', () => {
  const c = step(make(), 'notify'), end = step(c, 'accept', 'device', 30000)
  assert.equal(end.reason, 'no-answer'); assert.equal(step(end, 'joined', 'device', 31000), end)
  let active = step(step(c, 'accept', 'device'), 'joined')
  assert.equal(step(active, 'tick', null, 300000).reason, 'duration-limit')
})
test('官方业务模型：串房、时间倒退、非法事件和未接听挂断被拒绝', () => {
  const c = step(make(), 'notify')
  assert.throws(() => applyEvent(c, { callId: 'other', type: 'accept' }, 1), { code: 'CALL_MISMATCH' })
  assert.throws(() => step(c, 'tick', null, 0), { code: 'INVALID_EVENT' })
  for (const type of ['__proto__', 'toString', 'joined', 'hangup']) assert.throws(() => step(c, type, 'phone'), { code: 'INVALID_TRANSITION' })
  assert.throws(() => step(c, 'cancel', 'device'), { code: 'WRONG_ACTOR' })
})
for (const [event, reason] of [['offline','offline'], ['revoke','permission-revoked'], ['bindingChanged','binding-changed'], ['workerFailed','media-worker-failed']]) {
  test(`官方业务模型：${event} 终止通话`, () => {
    const c = step(step(step(make(), 'notify'), 'accept', 'device'), 'joined')
    const end = step(c, event); assert.equal(end.reason, reason); assert.equal(end.captureAllowed, false)
  })
}
test('官方接口助手：云代理参数不混用旧路线；提醒列表严格匹配官方 model_id', () => {
  assert.deepEqual(buildCloudCallRequest({ sn:'TEST-SN', modelId:'TEST-MODEL', mediaType:'video', isCloud:false }), { sn:'TEST-SN', modelId:'TEST-MODEL', roomType:'video', isCloud:true })
  assert.throws(() => buildCloudCallRequest({ sn:'a/b', modelId:'model', mediaType:'voice' }), { code:'INVALID_ARGUMENT' })
  const target = { sn:'TEST-SN', modelId:'TEST-MODEL' }, row = { sn:target.sn, model_id:target.modelId, status:1 }
  assert.equal(incomingReminderState([row], target), 'authorized')
  assert.equal(incomingReminderState([{...row, status:0}], target), 'unauthorized')
  assert.equal(incomingReminderState([{...row, model_id:'another'}], target), 'missing')
  assert.equal(incomingReminderState([{sn:target.sn, modelId:target.modelId, status:1}], target), 'missing')
  assert.equal(incomingReminderState([row,row], target), 'unknown')
  assert.equal(incomingReminderState([{...row,status:'1'}], target), 'unknown')
  assert.equal(incomingReminderState(null, target), 'unknown')
})
async function backend() {
  const f = await fixture()
  const sim = createSimulation({ simulation:true, authorize:f.service.authorize, now:f.now })
  const prepare = extra => sim.prepare(f.user, f.scope, { requestId:'synthetic-request', direction:'phone-to-device', mediaType:'voice', online:true, ...extra })
  const event = (c, type, actor) => sim.event(f.user,c.id,{scope:f.scope,type,actor})
  return {...f,sim,prepare,event}
}
test('本地后台演练：显式开关、幂等请求、并发设备锁且不写数据库', async () => {
  assert.throws(() => createSimulation({authorize:async()=>{}}), {code:'SIMULATION_ONLY'})
  const f = await backend(), before = JSON.stringify(f.repo.dump())
  const [a,b] = await Promise.all([f.prepare(), f.prepare()]); assert.equal(a.id,b.id)
  await assert.rejects(f.prepare({mediaType:'video'}), {code:'REQUEST_CONFLICT'})
  await assert.rejects(f.prepare({requestId:'second'}), {code:'DEVICE_BUSY'})
  assert.equal(JSON.stringify(f.repo.dump()), before)
  assert.equal(JSON.stringify(a).includes(f.user.openid), false)
})
test('本地后台演练：另一账号、跨家庭、旧绑定版本与伪造权限不允许', async () => {
  const f = await backend(), c = await f.prepare()
  await assert.rejects(f.sim.get({...f.user,openid:'synthetic-other'}, c.id), {code:'NOT_FOUND'})
  await assert.rejects(f.sim.get(null,c.id), {code:'AUTH_REQUIRED'})
  await assert.rejects(f.sim.event(f.user,c.id,{scope:{...f.scope,bindingVersion:2},type:'notify'}), {code:'BINDING_CHANGED'})
  await assert.rejects(f.sim.prepare(f.user,{...f.scope,familyId:'other'}, {requestId:'other',direction:'phone-to-device',mediaType:'voice',online:true}), {code:'BINDING_CHANGED'})
  await f.repo.put('mini_memberships','member-a',{...f.member,permissions:{viewDevice:true,callDevice:false}})
  await assert.rejects(f.sim.get(f.user,c.id), {code:'FORBIDDEN'})
  await f.repo.put('mini_memberships','member-a',f.member)
  assert.equal((await f.sim.get(f.user,c.id)).reason, 'permission-revoked')
})
test('本地后台演练：解绑立即失效；超时后允许新会话', async () => {
  const f = await backend(), c = await f.prepare()
  f.advance(30001)
  assert.equal((await f.sim.get(f.user,c.id)).reason,'no-answer')
  const next = await f.prepare({requestId:'next'})
  await f.repo.put('mini_bindings',f.scope.deviceId,{...f.binding,bindingVersion:2})
  await assert.rejects(f.event(next,'notify'),{code:'BINDING_CHANGED'})
})
test('本地后台演练：容量有界、反向提醒缺失不会建会话', async () => {
  const f = await backend()
  await assert.rejects(f.prepare({direction:'device-to-phone'}),{code:'REMINDER_REQUIRED'})
  const sim = createSimulation({simulation:true,authorize:f.service.authorize,now:f.now,maxSessions:1})
  const p = {requestId:'first',direction:'phone-to-device',mediaType:'voice',online:true}
  await sim.prepare(f.user,f.scope,p); f.advance(30001)
  await assert.rejects(sim.prepare(f.user,f.scope,{...p,requestId:'second'}),{code:'SIMULATION_LIMIT'})
})
test('云托管新准备接口：可信身份必需、只读、旧供应商配置不算官方配置、真实呼叫硬阻断', async () => {
  const f = await fixture(), config = readConfig({MINI_APP_ID:f.config.appid})
  const runtime = createRuntime(config,{repo:f.repo,provider:f.provider,now:f.now})
  const user = {...f.user,source:'wx-cloudrun-gateway'}, before = JSON.stringify(f.repo.dump())
  await assert.rejects(runtime.dispatch('official.voip.readiness',{},f.user),{code:'AUTH_REQUIRED'})
  const ready = await runtime.dispatch('official.voip.readiness',{},user)
  assert.equal(ready.nativeSdkLoaded,false); assert.equal(ready.liveCallEnabled,false)
  const rows = await runtime.dispatch('official.voip.targets',{},user)
  assert.equal(rows.length,1); assert.equal(rows[0].modelConfigured,false)
  assert.equal(rows[0].incomingReminder,'unknown'); assert.equal(rows[0].platformPermission,'unverified')
  await assert.rejects(runtime.dispatch('official.voip.outbound',{scope:f.scope,liveCallEnabled:true,simulation:true},user),{code:'OFFICIAL_VOIP_NOT_READY'})
  await assert.rejects(runtime.dispatch('official.voip.simulate',{scope:f.scope},user),{code:'INVALID_ACTION'})
  assert.deepEqual(await runtime.dispatch('official.voip.targets',{}, {...user,openid:'synthetic-other'}),[])
  assert.equal(JSON.stringify(f.repo.dump()),before); assert.equal(f.controls.invites.length,0)
})
test('云托管新准备接口：授权不足被拒、官方型号配置不等于平台验收', async () => {
  const f = await fixture(), runtime = createRuntime(readConfig({MINI_APP_ID:f.config.appid}),{repo:f.repo,provider:f.provider,now:f.now}), user = {...f.user,source:'wx-cloudrun-gateway'}
  await f.repo.put('mini_bindings',f.scope.deviceId,{...f.binding,officialVoip:{route:'wechat-rtos-cloud',sn:'TEST-SN',modelId:'TEST-MODEL'}})
  let rows = await runtime.dispatch('official.voip.targets',{},user)
  assert.equal(rows[0].modelConfigured,true); assert.equal(rows[0].liveCallEnabled,false); assert.equal('sn' in rows[0],false)
  await f.repo.put('mini_memberships','member-a',{...f.member,permissions:{viewDevice:true,callDevice:false}})
  assert.deepEqual(await runtime.dispatch('official.voip.targets',{},user),[])
  await assert.rejects(runtime.dispatch('official.voip.outbound',{scope:f.scope},user),{code:'FORBIDDEN'})
})
test('小程序演练：反向呼叫需模拟提醒、撤权结束、历史有界与重置', () => {
  const r = createRehearsal()
  assert.throws(() => r.start('device-to-phone'), {code:'REMINDER_REQUIRED'})
  r.policy('incomingReminder','authorized'); r.start('device-to-phone'); r.event('notify'); r.event('accept','phone'); r.event('joined')
  assert.equal(r.snapshot().stateLabel,'模拟连接')
  r.policy('callAllowed',false); assert.equal(r.snapshot().call.reason,'permission-revoked')
  r.reset(); assert.equal(r.snapshot().call,null); assert.equal(r.snapshot().history.length,0)
  for (let i=0;i<20;i++) { r.start('phone-to-device'); r.event('cancel','phone') }
  assert(r.snapshot().history.length<=12); assert.equal(r.snapshot().realCallEnabled,false)
})
test('小程序页面：不依赖网络或插件、按钮完整演练、离页清空、真实调用入口已移除', () => {
  let definition
  const file = require.resolve('../miniprogram/pages/my/official-voip-test')
  vm.runInNewContext(fs.readFileSync(file,'utf8'), {Page:x=>{definition=x}, require:name=>{
    assert.equal(name,'../../services/device/official-rehearsal'); return {createRehearsal}
  }})
  const p = {...definition,data:{...definition.data},setData(x){Object.assign(this.data,x)}}
  const e = type => ({currentTarget:{dataset:{type}}})
  p.onLoad(); p.onShow(); p.start(); p.step(e('notify')); p.step(e('accept')); p.step(e('joined'))
  assert.equal(p.data.view.call.state,'connected'); p.step(e('hangup')); assert.equal(p.data.view.call.state,'ended')
  p.start(); p.advance(); assert.equal(p.data.view.call.reason,'no-answer')
  p.onHide(); assert.equal(p.data.view.call,null); p.onShow(); p.onUnload(); assert.equal(p.rehearsal,null)
  const html = fs.readFileSync(require.resolve('../miniprogram/pages/my/debug.wxml'),'utf8')
  assert(html.includes('openOfficialVoip')); assert(!html.includes('探鸽')); assert(!html.includes('bindtap="authorizeReal"')); assert(!html.includes('bindtap="testRealCall"'))
})
