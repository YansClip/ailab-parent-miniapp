const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { fixture } = require('./fixtures/device-integration')
const { collections:C } = require('../cloudfunctions/miniDeviceGateway/lib/service')
const { handleCallback } = require('../cloudfunctions/miniDeviceGateway/lib/callback')
const { location } = require('../cloudfunctions/miniDeviceGateway/lib/contracts')
const unconfigured = require('../cloudfunctions/miniDeviceGateway/providers/unconfigured')

test('设备后台：只接受可信微信身份，拒绝伪造角色及跨家庭访问', async () => {
  const f=await fixture()
  await assert.rejects(f.run('context.list',{},{}),{code:'AUTH_REQUIRED'})
  await assert.rejects(f.run('device.snapshot',{role:'主管理员'},{openid:'intruder',appid:f.config.appid}),{code:'FORBIDDEN'})
  await assert.rejects(f.run('device.snapshot',{scope:{...f.scope,familyId:'other'}}),{code:'BINDING_CHANGED'})
  const list=await f.run('context.list'); assert.equal(list.length,1); assert.equal(list[0].deviceId,f.scope.deviceId)
})
test('设备后台：未建立正式关系返回空列表，不种植演示数据',async()=>{
  const f=await fixture(); assert.deepEqual(await f.run('context.list',{}, {openid:'new-user',appid:f.config.appid}),[])
  await f.repo.put(C.members,'member-a',{...f.member,consentActive:false})
  await assert.rejects(f.run('device.snapshot'),{code:'FORBIDDEN'})
})
test('定位：有效、离线、过期、错误坐标系、未知精度均正确',async()=>{
  const f=await fixture(); let d=await f.run('device.snapshot'); assert.equal(d.location.displayable,true)
  f.controls.online=false; d=await f.run('device.snapshot'); assert.equal(d.location.point,null); assert.equal(d.location.address,null)
  f.controls.online=true; f.advance(61000); d=await f.run('device.snapshot'); assert.equal(d.location.status,'stale'); assert.equal(d.location.point,null)
  f.advance(1);f.controls.fix=f.fix({coordinateSystem:'unknown'}); d=await f.run('device.snapshot'); assert.equal(d.location.displayable,false)
  f.advance(1);f.controls.fix=f.fix({accuracyM:null,coordinateSystem:'WGS84'}); d=await f.run('device.snapshot'); assert.equal(d.location.accuracyM,null);assert.equal(d.location.coordinateSystem,'GCJ02');assert.notEqual(d.location.point.longitude,120.15)
})
test('定位：仅保留最新点，旧采集时间不能覆盖新点；不保存轨迹',async()=>{
  const f=await fixture(); await f.run('device.snapshot'); const original=f.controls.fix
  f.advance(1000);f.controls.fix=f.fix(); await f.run('device.snapshot'); f.controls.fix=original
  const d=await f.run('device.snapshot');assert.equal(d.location.measuredAt,f.now())
  assert.equal(f.repo.dump().filter(([k])=>k.startsWith(C.locations+':')).length,1)
})
test('定位：同一采集记录被设备标记失效时立即清除坐标和地址',async()=>{
  const f=await fixture();await f.run('device.snapshot')
  f.controls.fix={...f.controls.fix,status:'failed'}
  const snapshot=await f.run('device.snapshot')
  assert.equal(snapshot.location.point,null);assert.equal(snapshot.location.address,null)
  const stored=await f.repo.get(C.locations,f.scope.deviceId)
  assert.equal(stored.latitude,null);assert.equal(stored.address,null)
})
test('定位：刷新幂等，受理不是成功，旧点不能完成新定位任务',async()=>{
  const f=await fixture(); await f.run('device.snapshot'); const op=await f.run('location.refresh',{requestId:'r1'})
  assert.equal(op.state,'submitted'); await f.run('location.refresh',{requestId:'r1'});assert.equal(f.controls.requests.length,1)
  const ev={eventId:'result1',kind:'operation',deviceId:f.scope.deviceId,bindingVersion:1,commandId:op.id,version:1,state:'success',location:f.controls.fix}
  await assert.rejects(f.service.deviceEvent(ev),{code:'OLD_FIX'})
  f.advance(1000);ev.location=f.fix();await f.service.deviceEvent(ev)
  assert.equal((await f.run('operation.get',{operationId:op.id})).state,'success')
  await f.service.deviceEvent({...ev,state:'executing',version:2})
  assert.equal((await f.run('operation.get',{operationId:op.id})).state,'success')
})
test('定位：超时后查询同一指令，可取得最终结果',async()=>{
  const f=await fixture();const op=await f.run('location.refresh',{requestId:'r2'});f.advance(11000)
  assert.equal((await f.run('operation.get',{operationId:op.id})).state,'timeout')
  f.controls.operationEvent={eventId:'late-fix',kind:'operation',commandId:op.id,version:2,state:'success',location:f.fix()}
  assert.equal((await f.run('operation.get',{operationId:op.id})).state,'success');assert.equal(f.controls.requests.length,1)
})
test('位置订阅：有到期时间，续期与离页停止不无限耗电',async()=>{
  const f=await fixture();const w=await f.run('location.watch',{requestId:'watch1'});assert.equal(w.expiresAt,f.now()+30000)
  f.advance(5000);const next=await f.run('location.watch',{requestId:'watch1'});assert.equal(next.id,w.id);assert(next.expiresAt>w.expiresAt)
  const stopped=await f.run('location.unwatch',{requestId:'watch1'});assert.equal(stopped.expiresAt,f.now())
  await assert.rejects(f.run('location.watch',{requestId:'watch1'}),{code:'WATCH_ENDED'})
})
test('语音/视频：准备、邀请、接通、挂断；客户端不能伪造接通',async()=>{
  for(const mediaType of ['voice','video']) {
    const f=await fixture();const c=await f.run('call.prepare',{requestId:'call1',mediaType});assert.equal(c.state,'preparing')
    await f.run('call.attach',{callId:c.id,roomId:'test-room'});await f.run('call.attach',{callId:c.id,roomId:'test-room'});assert.equal(f.controls.invites.length,1)
    await f.run('call.event',{callId:c.id,roomId:'test-room',eventName:'startVoip'})
    assert.equal((await f.run('call.get',{callId:c.id})).state,'calling')
    await assert.rejects(f.service.deviceEvent(f.callEvent(c,{state:'connected'})),{code:'CONSENT_REQUIRED'})
    await f.service.deviceEvent(f.callEvent(c,{state:'connected',childAccepted:true,mediaReady:true,videoReady:mediaType==='video'}))
    assert.equal((await f.run('call.get',{callId:c.id})).state,'connected')
    assert.equal((await f.run('call.end',{callId:c.id})).state,'ended')
    await f.service.deviceEvent(f.callEvent(c,{state:'connected',version:99,childAccepted:true,mediaReady:true,videoReady:true}))
    assert.equal((await f.run('call.get',{callId:c.id})).state,'ended')
  }
})
test('并发呼叫：同请求幂等、不同请求仅一个成功、不同家长不占用别人通话',async()=>{
  const f=await fixture();const results=await Promise.allSettled(['r1','r2'].map(requestId=>f.run('call.prepare',{requestId,mediaType:'voice'})))
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1)
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'DEVICE_BUSY')
  const c=results.find(x=>x.status==='fulfilled').value
  assert.equal((await f.run('call.prepare',{requestId:'r1',mediaType:'voice'})).id,c.id)
  assert.equal((await f.run('call.current')).id,c.id)
  await assert.rejects(f.run('call.end',{callId:c.id},{openid:'other',appid:f.config.appid}),{code:'NOT_FOUND'})
})
test('云对云：attach 不重复发邀请；经验证回调只发一次',async()=>{
  const f=await fixture();await f.repo.put(C.bindings,f.scope.deviceId,{...f.binding,media:{...f.binding.media,route:'cloud-device'}})
  const c=await f.run('call.prepare',{requestId:'r1',mediaType:'video'})
  const ev={eventId:'invite1',kind:'invitation',deviceId:f.scope.deviceId,bindingVersion:1,callId:c.id,roomId:'test-room'}
  await f.service.deviceEvent(ev);await f.run('call.attach',{callId:c.id,roomId:'test-room'});await f.service.deviceEvent(ev)
  assert.equal(f.controls.invites.length,1)
})
test('拒接、忙线、未接、中断均保留原因，低版本回执不倒退状态',async()=>{
  for(const endReason of ['rejected','busy','no-answer','interrupted']) {
    const f=await fixture();const c=await f.run('call.prepare',{requestId:'r1',mediaType:'voice'});await f.run('call.attach',{callId:c.id,roomId:'test-room'})
    await f.service.deviceEvent(f.callEvent(c,{version:3,state:'connecting'}));await f.service.deviceEvent(f.callEvent(c,{version:2,state:'ringing'}))
    assert.equal((await f.run('call.get',{callId:c.id})).state,'connecting')
    await f.service.deviceEvent(f.callEvent(c,{version:4,state:'ended',endReason}))
    assert.equal((await f.run('call.get',{callId:c.id})).endReason,endReason)
  }
})
test('挂断未确认不释放占用；撤权仍允许原呼叫人清理，但不可继续读数据',async()=>{
  const f=await fixture();const c=await f.run('call.prepare',{requestId:'r1',mediaType:'voice'});f.controls.endConfirmed=false
  assert.equal((await f.run('call.end',{callId:c.id})).state,'ending')
  await assert.rejects(f.run('call.prepare',{requestId:'r2',mediaType:'video'}),{code:'DEVICE_BUSY'})
  await f.repo.put(C.members,'member-a',{...f.member,consentActive:false})
  await assert.rejects(f.run('call.get',{callId:c.id}),{code:'FORBIDDEN'})
  f.controls.endConfirmed=true;assert.equal((await f.run('call.end',{callId:c.id})).state,'ended')
})
test('回调：默认拒绝、验签、防重放、绑定版本校验',async()=>{
  const f=await fixture();const ev={eventId:'loc1',kind:'location',deviceId:f.scope.deviceId,bindingVersion:1,location:f.fix()}
  const config={...f.config,callbackProtocol:'ailab-hmac-v1',callbackSecret:'unit-test-only-not-a-real-secret-12345'}
  const body=JSON.stringify(ev),ts=String(f.now()),nonce='callback1'
  const signature=crypto.createHmac('sha256',config.callbackSecret).update(ts+'\n'+nonce+'\n'+body).digest('hex')
  const req={httpMethod:'POST',headers:{'x-ailab-timestamp':ts,'x-ailab-nonce':nonce,'x-ailab-signature':signature},body}
  await assert.rejects(handleCallback(req,{...f,config:f.config}),{code:'CALLBACK_NOT_CONFIGURED'})
  await assert.rejects(handleCallback({...req,body:body+' '},{...f,config}),{code:'INVALID_SIGNATURE'})
  assert.equal((await handleCallback(req,{...f,config})).accepted,true)
  assert.equal((await handleCallback(req,{...f,config})).duplicate,true)
  await assert.rejects(f.service.deviceEvent({...ev,bindingVersion:0}),{code:'BINDING_CHANGED'})
  f.advance(300001);await assert.rejects(handleCallback(req,{...f,config}),{code:'CALLBACK_EXPIRED'})
})
test('缺少厂家配置明确阻断；错误精度不会编造准确数据',async()=>{
  await assert.rejects(unconfigured().getDevice(),{code:'PROVIDER_NOT_CONFIGURED'})
  const f=await fixture();const l=location(f.fix({accuracyM:NaN}),{online:true},f.config,f.now());assert.equal(l.accuracyM,null)
  await f.repo.put(C.bindings,f.scope.deviceId,{...f.binding,media:{...f.binding.media,approved:false}})
  await assert.rejects(f.run('call.prepare',{requestId:'r',mediaType:'video'}),{code:'MEDIA_NOT_CONFIGURED'})
})

test('定位权限与只读设备权限分开，不能读取其他设备返回的位置',async()=>{
  const f=await fixture()
  await f.repo.put(C.members,'member-a',{...f.member,permissions:{viewDevice:true,callDevice:true}})
  assert.equal((await f.run('device.status')).online,true)
  await assert.rejects(f.run('device.snapshot'),{code:'FORBIDDEN'})
  await f.repo.put(C.members,'member-a',f.member)
  f.controls.fix=f.fix({deviceId:'other-device'})
  await assert.rejects(f.run('device.snapshot'),{code:'BINDING_CHANGED'})
})
test('撤回授权后服务端主动终止会话和定位订阅，清理钩子不向客户端开放',async()=>{
  const f=await fixture()
  await f.run('location.watch',{requestId:'watch-revoke'})
  const c=await f.run('call.prepare',{requestId:'call-revoke',mediaType:'voice'})
  await f.repo.put(C.members,'member-a',{...f.member,consentActive:false})
  assert.equal((await f.service.reconcileAccess(f.user.openid)).closing,1)
  assert.equal((await f.repo.get(C.calls,c.id)).state,'ended')
  assert.equal((await f.repo.list(C.watches,{}))[0].stopped,true)
  await assert.rejects(f.run('maintenance'),{code:'INVALID_ACTION'})
  await assert.rejects(f.run('reconcileAccess'),{code:'INVALID_ACTION'})
})
test('维护任务清理失效点位和订阅；不删除刚更新的点位，不终止续期成功的订阅',async()=>{
  const f=await fixture()
  await f.run('device.snapshot');const watch=await f.run('location.watch',{requestId:'old-watch'})
  await f.repo.put(C.receipts,'old-receipt',{id:'old-receipt',expiresAt:f.now()+1000,complete:true})
  f.advance(61000)
  assert.equal((await f.service.maintenance()).removedLocations,1)
  assert.equal(await f.repo.get(C.locations,f.scope.deviceId),null)
  assert.equal((await f.repo.get(C.watches,watch.id)).stopped,true)
  assert.equal(await f.repo.get(C.receipts,'old-receipt'),null)
  f.controls.fix=f.fix();await f.run('device.snapshot')
  const fresh=await f.run('location.watch',{requestId:'fresh-watch'})
  f.advance(5000);await f.run('location.watch',{requestId:'fresh-watch'})
  assert.equal((await f.service.maintenance()).removedLocations,0)
  assert.equal((await f.repo.get(C.watches,fresh.id)).stopped,false)
})
test('后台查询拒绝其他会话回执，执行中的定位指令不退回已受理',async()=>{
  const f=await fixture()
  const c=await f.run('call.prepare',{requestId:'q-call',mediaType:'voice'})
  f.controls.callEvent=f.callEvent(c,{callId:'different-call'})
  await assert.rejects(f.run('call.get',{callId:c.id}),{code:'INVALID_RESPONSE'})
  const op=await f.run('location.refresh',{requestId:'q-fix'})
  const e={eventId:'op-event',kind:'operation',deviceId:f.scope.deviceId,bindingVersion:1,commandId:op.id,state:'executing',version:1}
  await f.service.deviceEvent(e);await f.service.deviceEvent({...e,state:'accepted',version:2})
  assert.equal((await f.run('operation.get',{operationId:op.id})).state,'executing')
})
