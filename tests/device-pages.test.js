const test = require('node:test')
const assert = require('node:assert/strict')

test('接入模式守护页面：有效期、离页、乱序和失败状态', async t => {
  const originals = { wx:global.wx, Page:global.Page, getApp:global.getApp, getCurrentPages:global.getCurrentPages,
    setTimeout:global.setTimeout, clearTimeout:global.clearTimeout, setInterval:global.setInterval, clearInterval:global.clearInterval, now:Date.now }
  let definition, mounted = [], now = 1800000000000, seq = 0
  const timers = new Map(), memory = new Map(), stopped = []
  global.wx = {getStorageSync:k=>memory.get(k)||'',setStorageSync:(k,v)=>memory.set(k,v),showToast(){},onNetworkStatusChange(){},offNetworkStatusChange(){}}
  global.Page = v => { definition = v }
  global.getApp = () => ({globalData:{statusBarHeight:44}})
  global.getCurrentPages = () => mounted
  Date.now = () => now
  global.setTimeout = (fn,delay) => { const id=++seq;timers.set(id,{fn,at:now+delay,interval:false});return id }
  global.setInterval = (fn,delay) => { const id=++seq;timers.set(id,{fn,at:now+delay,interval:true});return id }
  global.clearTimeout = global.clearInterval = id => timers.delete(id)
  const api = require('../miniprogram/services/api'), saved = {...api}
  const store = require('../miniprogram/services/store')
  store.init();store.setSession({loggedIn:true,privacyAccepted:true,familyReady:true})
  const fix = () => ({child:{id:'real-child',shortName:'真实测试孩子'},deviceId:'real-device',online:true,battery:80,isDemo:false,
    point:{latitude:30,longitude:120},label:'测试区域',status:'valid',updatedAt:now,receivedAt:now,remainingMs:1500,expiresAt:now+1500,accuracy:15})
  api.getDeviceMode=()=> 'cloud'
  api.getGuardChildren=async()=>[{id:'real-device',shortName:'真实测试孩子'}]
  api.getLocation=async()=>fix()
  api.watchLocation=async(stop,lease)=>{if(stop){stopped.push(lease);return null}return{requestId:'watch',pollMs:5000}}
  async function flush(){for(let i=0;i<30;i++)await Promise.resolve()}
  async function open(){
    delete require.cache[require.resolve('../miniprogram/pages/guard/index')]
    require('../miniprogram/pages/guard/index')
    const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(p){assert(!this.__hidden&&!this.__disposed);Object.assign(this.data,p)}}
    mounted.push(page);page.onShow();await flush();return page
  }
  function close(p){p.onHide();p.onUnload();mounted=mounted.filter(x=>x!==p)}
  try {
    await t.test('按后台剩余有效期准确移除坐标，不等待十秒年龄刷新',async()=>{
      const page=await open();assert.equal(page.data.markers.length,1)
      const expiry=timers.get(page.expiryTimer);assert.equal(expiry.at,now+1500)
      now+=1500;expiry.fn()
      assert.equal(page.data.loc.point,null);assert.equal(page.data.loc.address,null);assert.equal(page.data.markers.length,0)
      close(page);assert.equal(timers.size,0)
    })
    await t.test('后台订阅晚于离页返回时，清理对应旧订阅且不继续轮询',async()=>{
      let release
      api.watchLocation=(stop,lease)=>{if(stop){stopped.push(lease);return Promise.resolve(null)}return new Promise(resolve=>{release=resolve})}
      const page=await open();close(page)
      release({requestId:'old-watch',pollMs:5000});await flush()
      assert(stopped.some(x=>x&&x.requestId==='old-watch'));assert.equal(timers.size,0)
    })
    await t.test('离页后的慢定位响应不写回页面，也不创建新的订阅',async()=>{
      let release
      api.getLocation=()=>new Promise(resolve=>{release=resolve})
      const page=await open();close(page);release(fix());await flush()
      assert.equal(page.data.loc.point,null);assert.equal(timers.size,0)
    })
    await t.test('云服务配置错误显示可重试错误，不显示演示点位',async()=>{
      api.getLocation=async()=>{throw{code:'CONFIG_REQUIRED',message:'设备云尚未配置'}}
      const page=await open();assert.equal(page.data.loading,false);assert.equal(page.data.error,'设备云尚未配置');assert.equal(page.data.loc.point,null)
      close(page)
    })
    await t.test('本机联调静默更新不闪烁，服务断开后清点且不回退演示',async()=>{
      api.getDeviceMode=()=> 'lab'
      api.watchLocation=async()=>({pollMs:2000})
      api.getLocation=async()=>({...fix(),isLab:true})
      const page=await open();assert.equal(page.data.isLab,true);assert.equal(page.data.markers.length,1)
      let finish
      api.getLocation=()=>new Promise(resolve=>{finish=resolve})
      const update=page.reload(true);await flush()
      assert.equal(page.data.loading,false);assert.equal(page.data.markers.length,1)
      finish({...fix(),point:null,status:'offline',online:false});await update
      assert.equal(page.data.loc.point,null);assert.equal(page.data.markers.length,0)
      api.getLocation=async()=>{throw {message:'本机配对已失效'}}
      await page.reload(true);assert.equal(page.data.error,'本机配对已失效');assert.equal(page.data.loc.point,null)
      close(page);assert.equal(timers.size,0)
    })
    await t.test('本机通话准备无 undefined；重进保留同一会话，不自动重拨',async()=>{
      delete require.cache[require.resolve('../miniprogram/pages/guard/call')]
      require('../miniprogram/pages/guard/call')
      const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(p){Object.values(p).forEach(v=>assert.notEqual(v,undefined));Object.assign(this.data,p)}}
      let starts=0
      api.getCallTarget=async()=>({child:{shortName:'本机模拟'},capabilities:{voice:true,video:true}})
      api.getCallSession=async()=>({id:'lab-test-1',stage:'connected',mediaType:'voice',connectedAt:now-2000})
      api.startCall=()=>{starts++;throw new Error('must not start')}
      mounted.push(page);page.onLoad();page.applySession({stage:'preparing',mediaType:'voice'})
      assert.equal(page.data.callId,'')
      page.onShow();await flush();assert.equal(page.data.callId,'lab-test-1')
      page.onHide();page.onShow();await flush();assert.equal(starts,0);assert.equal(page.data.stage,'connected')
      close(page);assert.equal(timers.size,0)
    })
  } finally {
    mounted.forEach(close);Object.assign(api,saved)
    for(const k of ['wx','Page','getApp','getCurrentPages','setTimeout','clearTimeout','setInterval','clearInterval'])global[k]=originals[k]
    Date.now=originals.now
  }
})

test('返回按钮使用明确 delta，失败有反馈，单页启动返回首页', () => {
  const previous = { Component:global.Component, wx:global.wx, getCurrentPages:global.getCurrentPages }
  let definition, navigation, feedback, target
  global.Component = value => {definition=value}
  global.wx = {navigateBack:options=>{navigation=options},showToast:options=>{feedback=options.title},switchTab:options=>{target=options.url}}
  global.getCurrentPages = () => [{},{}]
  try {
    delete require.cache[require.resolve('../miniprogram/components/nav-bar/index')]
    require('../miniprogram/components/nav-bar/index')
    definition.methods.onBack();assert.equal(navigation.delta,1)
    navigation.fail();assert.match(feedback,/返回/)
    global.getCurrentPages = () => [{}]
    definition.methods.onBack();assert.equal(target,'/pages/home/index')
  } finally { Object.assign(global,previous) }
})
