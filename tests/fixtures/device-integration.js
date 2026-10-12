const { createService, collections: C } = require('../../cloudfunctions/miniDeviceGateway/lib/service')
const copy = v => v == null ? v : JSON.parse(JSON.stringify(v))
function memoryRepository() {
  let data = new Map(), queue = Promise.resolve()
  const access = {
    async get(c,id) { return copy(data.get(c + ':' + id) || null) },
    async put(c,id,v) { data.set(c + ':' + id,copy(v)); return copy(v) },
    async remove(c,id) { data.delete(c + ':' + id) },
    async list(c,where) { return [...data.entries()].filter(([k,v]) => k.startsWith(c + ':') && Object.entries(where).every(([f,x]) => v[f] === x)).map(([,v]) => copy(v)) }
  }
  return { ...access, async transaction(fn) {
    const job = queue.then(async () => { const before = new Map([...data].map(([k,v]) => [k,copy(v)])); try { return await fn(access) } catch(e) { data = before; throw e } })
    queue = job.catch(() => {}); return job
  }, dump() { return [...data.entries()] } }
}
async function fixture() {
  let time = 1800000000000
  const now = () => time, repo = memoryRepository()
  const config = { appid:'wxc5abf3407ed4ef30', locationTtlMs:60000, statusTtlMs:30000, watchLeaseMs:30000, pollMs:5000, refreshTimeoutMs:10000, callInviteTimeoutMs:30000, maxCallMs:600000 }
  const user = { openid:'test-parent-a', appid:config.appid }
  const scope = { familyId:'test-family', childId:'test-child', deviceId:'test-device', bindingVersion:1 }
  const binding = { ...scope, active:true, childName:'测试孩子', deviceName:'测试 Mini', media:{route:'linux-direct',sn:'TEST-SN',modelId:'TEST-MODEL',approved:true} }
  const member = { openid:user.openid, familyId:scope.familyId, childIds:[scope.childId], active:true, consentActive:true, permissions:{viewDevice:true,locateDevice:true,callDevice:true} }
  await repo.put(C.bindings,scope.deviceId,binding); await repo.put(C.members,'member-a',member)
  const controls = { online:true, invites:[], ends:[], watches:[], requests:[], operationEvent:null, callEvent:null, endConfirmed:true, fix:null }
  const fix = (extra={}) => ({fixId:'fix-'+now(),deviceId:scope.deviceId,bindingVersion:1,latitude:30.25,longitude:120.15,coordinateSystem:'GCJ02',accuracyM:20,source:'GNSS',measuredAt:now(),status:'valid',address:'测试区域',...extra})
  controls.fix = fix()
  const provider = {
    async getDevice() { return {deviceId:scope.deviceId,bindingVersion:1,online:controls.online,battery:72,stateTime:now(),capabilities:{location:true,voice:true,video:true}} },
    async getLocation() { return controls.fix },
    async startWatch(w) { controls.watches.push(copy(w)) }, async stopWatch(w) { controls.watches.push(copy(w)) },
    async refreshLocation(r) { controls.requests.push(copy(r)) },
    async getOperation() { const e=controls.operationEvent; controls.operationEvent=null; return e && {deviceId:scope.deviceId,bindingVersion:scope.bindingVersion,...e} },
    async inviteCall(c) { controls.invites.push(copy(c)) },
    async endCall(c) { controls.ends.push(copy(c)); return {confirmed:controls.endConfirmed} },
    async getCall() { const e=controls.callEvent; controls.callEvent=null; return e }
  }
  const service = createService({repo,provider,config,now})
  const run = (action,p={},actor=user) => service.dispatch(action,{scope,...p},actor)
  const callEvent = (c,patch={}) => ({eventId:'ev-'+now(),kind:'call',deviceId:scope.deviceId,bindingVersion:1,callId:c.id,roomId:'test-room',version:1,state:'ringing',...patch})
  return {repo,config,user,scope,binding,member,controls,fix,provider,service,run,callEvent,now,advance(ms){time+=ms}}
}
module.exports = {fixture,memoryRepository}
