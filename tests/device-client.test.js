const test = require('node:test')
const assert = require('node:assert/strict')
const { fixture } = require('./fixtures/device-integration')
const { createDeviceClient } = require('../miniprogram/services/device/client')
const { createVoip } = require('../miniprogram/services/device/voip')
async function clientFixture() {
  const f=await fixture(), memory=new Map(), network=[], mediaEvents={stops:[],creates:[],shows:0}, session={privacyAccepted:true}, config={mode:'cloud',envId:'unit-test-env',functionName:'test-gateway',requestTimeoutMs:200}
  let epoch=1, handler=null
  const store={getEpoch:()=>epoch,getSession:()=>session}
  const wxApi={getStorageSync:k=>memory.get(k),setStorageSync:(k,v)=>memory.set(k,JSON.parse(JSON.stringify(v))),removeStorageSync:k=>memory.delete(k),cloud:{init(){},async callFunction({data}){
    network.push(data)
    try{return {result:{ok:true,data:await f.service.dispatch(data.action,data.payload,f.user)}}}catch(e){return{result:{ok:false,error:{code:e.code,message:e.message}}}}
  }}}
  const media={ensure(){},listen(fn){handler=fn},async create(c){mediaEvents.creates.push(c);return 'test-room'},async show(){mediaEvents.shows++},stop(id){mediaEvents.stops.push(id)},dispose(){}}
  const client=createDeviceClient({config,store,wxApi,media,clock:f.now})
  return {...f,client,media,wxApi,network,mediaEvents,config,memory,session,bump(){epoch++},emit(e){handler(e)}}
}
test('客户端：真实模式取后台授权设备，不使用演示孩子/设备',async()=>{
  const f=await clientFixture();const targets=await f.client.loadTargets();assert.equal(targets[0].id,'test-device')
  const loc=await f.client.snapshot();assert.equal(loc.isDemo,false);assert.equal(loc.child.id,'test-child');assert.equal(loc.point.latitude,30.25)
  assert(!JSON.stringify([...f.memory]).includes('30.25'))
})
test('客户端：缺云配置/权限/接口失败均阻断，没有模拟兜底',async()=>{
  const f=await clientFixture();f.config.envId='';await assert.rejects(f.client.snapshot(),{code:'CONFIG_REQUIRED'})
  f.config.envId='test-env';f.wxApi.cloud.callFunction=async()=>{throw new Error('network')}
  await assert.rejects(f.client.snapshot(),{code:'NETWORK_ERROR'})
})
test('客户端：同一个刷新任务可连续查询，未获取新定位不假成功',async()=>{
  const f=await clientFixture();await f.client.loadTargets();const op=await f.client.refresh();assert.equal(op.state,'submitted')
  assert.equal((await f.client.refresh()).id,op.id);assert.equal(f.controls.requests.length,1)
  f.advance(1000);f.controls.operationEvent={eventId:'newloc',kind:'operation',commandId:op.id,version:1,state:'success',location:f.fix()}
  assert.equal((await f.client.refresh()).state,'success')
})
test('客户端：双击只创建一次通话，视频参数正确，官方事件不独自报接通',async()=>{
  const f=await clientFixture();const [a,b]=await Promise.all([f.client.start('video'),f.client.start('video')]);assert.equal(a.id,b.id);assert.equal(f.mediaEvents.creates.length,1);assert.equal(a.mediaType,'video');assert.equal(a.stage,'calling')
  f.emit({eventName:'startVoip',roomId:'test-room'});await new Promise(r=>setImmediate(r));assert.equal((await f.client.getCall()).stage,'calling')
  await f.service.deviceEvent(f.callEvent(a,{state:'connected',childAccepted:true,mediaReady:true,videoReady:true}));assert.equal((await f.client.getCall()).stage,'connected')
  await f.client.cleanup();assert(f.mediaEvents.stops.includes('test-room'));assert.equal(f.controls.ends.length,1)
})
test('客户端：离页/重建客户端查原会话，不自动重拨',async()=>{
  const f=await clientFixture();await f.client.start('voice')
  const restored=createDeviceClient({config:f.config,store:{getEpoch:()=>1,getSession:()=>f.session},wxApi:f.wxApi,media:f.media,clock:f.now})
  assert.equal((await restored.getCall()).stage,'calling');assert.equal(f.mediaEvents.creates.length,1)
})
test('客户端：新微信进程无本地指针也能查回后台会话',async()=>{
  const f=await clientFixture();const c=await f.run('call.prepare',{requestId:'server-created',mediaType:'voice'})
  await f.client.loadTargets();assert.equal((await f.client.getCall()).id,c.id);assert.equal(f.mediaEvents.creates.length,0)
})
test('客户端：延迟响应遇到撤权/退出时不能写回，且清理真实媒体',async()=>{
  const f=await clientFixture();await f.client.start('voice');const request=f.wxApi.cloud.callFunction
  let release
  f.wxApi.cloud.callFunction=async input=>{if(input.data.action==='device.snapshot')await new Promise(r=>{release=r});return request(input)}
  const pending=f.client.snapshot();await new Promise(r=>setImmediate(r));f.bump();f.session.privacyAccepted=false;f.client.invalidate();release()
  await assert.rejects(pending,{code:'STALE_CONTEXT'});await new Promise(r=>setImmediate(r));assert(f.mediaEvents.stops.includes('test-room'));assert.equal(f.controls.ends.length,1)
})
test('客户端：超时后才返回的通话准备结果会补发清理，而不是后台挂起',async()=>{
  const f=await clientFixture();f.config.requestTimeoutMs=10;const request=f.wxApi.cloud.callFunction
  let release
  f.wxApi.cloud.callFunction=async input=>{const response=await request(input);if(input.data.action==='call.prepare')await new Promise(r=>{release=r});return response}
  await assert.rejects(f.client.start('voice'),{code:'REQUEST_TIMEOUT'});release();await new Promise(r=>setTimeout(r,15));assert.equal(f.controls.ends.length,1);assert.equal(f.mediaEvents.creates.length,0)
})
test('客户端：订阅停止后旧订阅迟到不覆盖新订阅句柄',async()=>{
  const f=await clientFixture();await f.client.loadTargets();const old=await f.client.watch(false);await f.client.watch(true,old);const latest=await f.client.watch(false)
  assert.notEqual(old.requestId,latest.requestId);await f.client.watch(true,old);const renew=await f.client.watch(false);assert.equal(renew.requestId,latest.requestId)
})
test('官方媒体适配：未授权/缺插件不启动；Linux 与云对云参数分开',async()=>{
  assert.throws(()=>createVoip({settings:{enabled:false}}).ensure(),{code:'MEDIA_NOT_CONFIGURED'})
  assert.throws(()=>createVoip({settings:{enabled:true},getPlugin(){throw Error()}}).ensure(),{code:'PLUGIN_UNAVAILABLE'})
  assert.throws(()=>createVoip({settings:{enabled:true},getPlugin:()=>({default:{callDevice(){}}})}).ensure(),{code:'PLUGIN_UNAVAILABLE'})
  for(const route of ['linux-direct','cloud-device']) {
    let payload,offCount=0,stopped
    const adapter=createVoip({settings:{enabled:true,pluginAlias:'test'},getPlugin:()=>({default:{CALL_PAGE_PATH:'plugin-test',onVoipEvent(){return()=>offCount++},async callDevice(p){payload=p;return{roomId:'r1'}},forceHangUpVoip(r){stopped=r}}}),navigate:async()=>{}})
    adapter.listen(()=>{});adapter.listen(()=>{});assert.equal(offCount,1)
    await adapter.create({id:'c1',mediaType:'video',plugin:{route,sn:'test',modelId:'test',timeLimit:60}})
    assert.equal(payload.roomType,'video');assert.equal(payload.isCloud,route==='cloud-device');assert.equal(!!payload.payload,route==='cloud-device')
    adapter.stop('r1');assert.equal(stopped,'r1');adapter.dispose();assert.equal(offCount,2)
  }
})

test('客户端：活动通话期间禁止切换到另一个孩子；结束后才允许切换',async()=>{
  const f=await clientFixture()
  await f.repo.put('mini_bindings','test-device-b',{...f.binding,deviceId:'test-device-b',childId:'test-child-b'})
  await f.repo.put('mini_memberships','member-a',{...f.member,childIds:[f.scope.childId,'test-child-b']})
  await f.client.loadTargets();await f.client.start('voice')
  await assert.rejects(f.client.select('test-device-b'),{code:'CALL_ACTIVE'})
  assert.equal(f.client.selectedId(),'test-device')
  await f.client.cleanup();await f.client.select('test-device-b')
  assert.equal(f.client.selectedId(),'test-device-b')
})
test('客户端：准备期间取消，迟到的后台会话被结束，不启动媒体',async()=>{
  const f=await clientFixture();const request=f.wxApi.cloud.callFunction
  let release
  f.wxApi.cloud.callFunction=async input=>{const response=await request(input);if(input.data.action==='call.prepare')await new Promise(r=>{release=r});return response}
  const pending=f.client.start('video')
  await new Promise(r=>setImmediate(r));assert.equal(typeof release,'function')
  await f.client.cleanup();release()
  await assert.rejects(pending,{code:'CALL_CANCELLED'})
  assert.equal(f.mediaEvents.creates.length,0);assert.equal(f.controls.ends.length,1)
})
test('客户端：插件挂断异步失败也请求后台结束，并保留清理重试入口',async()=>{
  const f=await clientFixture();await f.client.start('video')
  f.media.stop=async()=>{throw Error('plugin failure')}
  assert.equal((await f.client.cleanup()).stage,'ending');assert.equal(f.controls.ends.length,1)
  f.media.stop=async()=>{}
  assert.equal((await f.client.getCall()).stage,'ended')
})
