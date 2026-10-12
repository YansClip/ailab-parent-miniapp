const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { startLab } = require('../tools/synthetic-location-lab/server')
const { createSyntheticClient } = require('../miniprogram/services/device/synthetic-location')
const { project } = require('../miniprogram/services/device/synthetic-view')
const appId = 'wxc5abf3407ed4ef30'
async function fixture(t) {
  let now = 1800000000000
  const lab = await startLab({ port: 0, clock: () => now }); t.after(() => lab.stop())
  const html = await (await fetch(lab.base)).text(), token = html.match(/name="sim-control" content="([a-f0-9]+)"/)[1]
  async function request(route, { data, credential = token, origin = lab.base, host } = {}) {
    if (host) return new Promise((resolve, reject) => {
      require('node:http').get(lab.base + '/api/' + route, { headers: { host, 'x-sim-token': credential } }, res => {
        let bytes = ''; res.on('data', b => { bytes += b }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(bytes) }))
      }).on('error', reject)
    })
    const r = await fetch(lab.base + '/api/' + route, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(credential ? { 'x-sim-token': credential } : {}), ...(origin ? { origin } : {}), ...(host ? { host } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) })
    return { status: r.status, body: await r.json() }
  }
  async function action(name) { const r = await request('action', { data: { action: name } }); assert.equal(r.body.ok, true, JSON.stringify(r.body)); return r.body.data }
  return { ...lab, request, action, now: () => now, advance: n => { now += n }, html }
}
test('本机模拟定位：实际签名HTTP→临时存储→权限查询→展示；异常清点，不触及云端', async t => {
  const f = await fixture(t), view = s => project(s, f.now(), f.now())
  assert.equal(view((await f.request('state')).body.data).status, 'waiting')
  const a = await f.action('point-a')
  assert.equal(view(a).longitude, '120.0001'); assert.equal(view(a).pointName, 'A')
  assert.equal(a.snapshot.capabilities.voice, false); assert.equal(a.snapshot.capabilities.video, false)
  assert.equal(a.storage, 'volatile-memory'); assert.equal(a.cloudConnected, false)
  assert.equal(view(await f.action('point-b')).pointName, 'B')
  for (const [action, status] of [['no-fix', 'no-fix'], ['offline', 'offline'], ['expire', 'expired']]) {
    await f.action('point-a')
    const state = await f.action(action)
    assert.equal(view(state).status, status); assert.equal(state.snapshot.location.point, null)
    assert(!JSON.stringify(state).includes('120.0001'))
  }
  await f.action('point-a')
  const denied = await f.action('revoke'); assert.equal(view(denied).status, 'denied'); assert.equal(denied.snapshot, null)
  assert(!JSON.stringify(denied).includes('120.0001'))
  assert.equal(view(await f.action('restore')).hasPoint, true)
  for (const name of ['other-parent', 'bad-signature', 'old-binding']) {
    const s = await f.action(name)
    assert.equal(s.lastResult.expectedDenial, true)
    assert.equal(view(s).pointName, 'A')
  }
  f.advance(16000)
  assert.equal(view((await f.request('state')).body.data).hasPoint, false)
  assert((await f.request('state')).body.data.history.length <= 8)
})
test('本机隔离：配对一次性/只读、Host与Origin防护、禁止任意数据、过期退出', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('state', { credential: '' })).body.error.code, 'UNPAIRED')
  assert.equal((await f.request('state', { origin: 'https://example.com' })).body.error.code, 'FORBIDDEN')
  assert.equal((await f.request('state', { host: 'other.example' })).body.error.code, 'FORBIDDEN')
  assert.equal((await f.request('action', { data: { action: 'point-a' }, origin: '' })).body.error.code, 'FORBIDDEN')
  assert.equal((await f.request('action', { data: { action: 'point-a', latitude: 31, name: 'not-allowed' } })).body.error.code, 'INVALID_ARGUMENT')
  const code = (await f.request('state')).body.data.pairingCode
  const pair = await f.request('pair', { credential: '', origin: '', data: { code } })
  const credential = pair.body.data.token
  assert.equal(pair.body.ok, true)
  assert.equal((await f.request('pair', { credential: '', data: { code } })).body.error.code, 'PAIR_INVALID')
  const s = (await f.request('state', { credential, origin: '' })).body.data
  assert.equal(s.pairingCode, undefined); assert.equal(s.paired, undefined)
  assert.equal((await f.request('action', { credential, data: { action: 'restore' } })).body.error.code, 'FORBIDDEN')
  await f.action('pairing')
  assert.equal((await f.request('state', { credential })).body.error.code, 'UNPAIRED')
  const code2 = (await f.request('state')).body.data.pairingCode
  f.advance(300001)
  assert.equal((await f.request('pair', { credential: '', data: { code: code2 } })).body.error.code, 'PAIR_INVALID')
  await f.action('pairing')
  const code3 = (await f.request('state')).body.data.pairingCode
  const p3 = await f.request('pair', { credential: '', data: { code: code3 } })
  f.advance(1800001)
  assert.equal((await f.request('state', { credential: p3.body.data.token })).body.error.code, 'UNPAIRED')
  assert.equal((await fetch(f.base + '/../../package.json')).status, 404)
  assert.equal((await fetch(f.base)).headers.get('cache-control'), 'no-store')
  for (const asset of ['/app.js', '/style.css', '/view.js']) assert.equal((await fetch(f.base + asset)).status, 200)
})
test('本机数据不落盘：重启不保留坐标、权限修改或配对码', async t => {
  const first = await fixture(t), code = (await first.request('state')).body.data.pairingCode
  await first.action('point-a'); await first.action('revoke'); await first.stop()
  const second = await fixture(t), s = (await second.request('state')).body.data
  assert.equal(s.permissionGranted, true); assert.equal(s.history.length, 0); assert.equal(s.reason, 'waiting')
  assert.notEqual(s.pairingCode, code); assert.equal(s.snapshot.location.point, null)
})
test('本机投影：网络耗时扣除、到时清点、拒绝非本机/非预设响应', async t => {
  const f = await fixture(t), s = await f.action('point-a'), now = f.now()
  assert.equal(project(s, now - 4000, now).remainingSeconds, 11)
  assert.equal(project(s, now, now + 15000).hasPoint, false)
  assert.throws(() => project({ ...s, cloudConnected: true }, now, now))
  assert.throws(() => project({ ...s, scope: { deviceId: 'cloud-device' } }, now, now))
  s.snapshot.location.point.longitude = 121
  assert.throws(() => project(s, now, now))
})
function fakeWx() {
  const pending = []
  const wxApi = { getAccountInfoSync: () => ({ miniProgram: { appId, envVersion: 'develop' } }), getDeviceInfo: () => ({ platform: 'devtools' }),
    request(o) { const task = { aborted: false, abort() { this.aborted = true; o.fail() } }; pending.push({ o, task }); return task } }
  return { wxApi, pending, reply(entry, data) { entry.o.success({ statusCode: 200, data: { ok: true, data } }) } }
}
test('小程序本机客户端：真机/体验版/其他项目先拒绝，不发请求', async () => {
  for (const [platform, envVersion, id] of [['ios', 'develop', appId], ['devtools', 'trial', appId], ['devtools', 'release', appId], ['devtools', 'develop', 'other']]) {
    let requests = 0
    const c = createSyntheticClient({ wxApi: { getAccountInfoSync: () => ({ miniProgram: { appId: id, envVersion } }), getDeviceInfo: () => ({ platform }), request() { requests++ } } })
    assert(c.availability()); await assert.rejects(c.pair('AABBCCDDEE'), { code: 'DEVTOOLS_ONLY' }); assert.equal(requests, 0)
  }
})
test('小程序本机客户端：固定地址、内存配对、旧请求取消、不调用云端', async () => {
  const f = fakeWx(), now = 1800000000000, c = createSyntheticClient({ wxApi: f.wxApi, clock: () => now })
  const pair = c.pair('AABBCCDDEE')
  assert.equal(f.pending[0].o.url, 'http://127.0.0.1:18868/api/pair')
  assert.deepEqual(f.pending[0].o.data, { code: 'AABBCCDDEE' })
  f.reply(f.pending[0], { token: 'a'.repeat(64), expiresAt: now + 1800000, contract: 'ailab-synthetic-location/v1' }); await pair
  assert(c.paired())
  const state = c.state(), rejected = assert.rejects(state, { code: 'CANCELLED' })
  assert.equal(f.pending[1].o.method, 'GET'); assert.equal(f.pending[1].o.timeout, 5000)
  assert.equal(f.pending[1].o.header['x-sim-token'], 'a'.repeat(64))
  c.clear(); await rejected; assert.equal(f.pending[1].task.aborted, true); assert.equal(c.paired(), false)
  f.reply(f.pending[1], { late: true }); assert.equal(c.paired(), false)
  const late = c.pair('0011223344'), lateRejected = assert.rejects(late, { code: 'CANCELLED' })
  c.clear(); f.reply(f.pending[2], { token: 'b'.repeat(64), expiresAt: now + 1000, contract: 'ailab-synthetic-location/v1' }); await lateRejected
  assert.equal(c.paired(), false)
  await assert.rejects(c.state(), { code: 'UNPAIRED' })
})
test('小程序测试页：HTTP回包显示、无网时仍到期清点、离页停止轮询且不接受迟到响应', async t => {
  const f = await fixture(t), state = await f.action('point-a'), wx = fakeWx()
  const saved = { wx: global.wx, Page: global.Page, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, now: Date.now }
  const timers = new Map(); let definition, now = f.now(), next = 0, hidden = false
  global.wx = wx.wxApi; global.Page = v => { definition = v }; Date.now = () => now
  global.setTimeout = (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id }; global.clearTimeout = id => timers.delete(id)
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  const pairResponse = { token: 'a'.repeat(64), expiresAt: now + 1800000, contract: 'ailab-synthetic-location/v1' }
  try {
    delete require.cache[require.resolve('../miniprogram/pages/my/location-test')]; require('../miniprogram/pages/my/location-test')
    const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { assert.equal(hidden, false); Object.assign(this.data, p) } }
    page.onLoad(); page.onShow(); page.inputCode({ detail: { value: 'AABBCCDDEE' } })
    const pairing = page.pair(); wx.reply(wx.pending[0], pairResponse); await flush(); wx.reply(wx.pending[1], state); await pairing
    assert.equal(page.data.view.pointName, 'A'); assert.equal(page.data.view.hasPoint, true)
    now += 15000
    const expiry = timers.get(page.expiryTimer); timers.delete(page.expiryTimer); expiry.fn()
    assert.equal(page.data.view.hasPoint, false); assert.equal(page.latest, null)
    const refresh = page.refresh(); page.onHide(); hidden = true
    assert.equal(page.data.view.hasPoint, false); assert.equal(page.client.paired(), false); assert.equal(timers.size, 0)
    wx.reply(wx.pending[2], state); await refresh; page.onUnload()
    assert.equal(page.latest, null); assert.equal(timers.size, 0)
  } finally { global.wx = saved.wx; global.Page = saved.Page; global.setTimeout = saved.setTimeout; global.clearTimeout = saved.clearTimeout; Date.now = saved.now }
})
test('模拟页面不取手机定位、不引入真实地图/音视频/云数据库、不切换主模式', () => {
  const sources = ['miniprogram/pages/my/location-test.js', 'miniprogram/services/device/synthetic-location.js', 'tools/synthetic-location-lab/app.js'].map(p => fs.readFileSync(require('node:path').join(__dirname, '..', p), 'utf8')).join('\n')
  for (const forbidden of ['wx.getLocation', 'wx.cloud', 'callContainer', 'setStorageSync', 'services/api', 'services/store']) assert(!sources.includes(forbidden), forbidden)
  const wxml = fs.readFileSync(require('node:path').join(__dirname, '../miniprogram/pages/my/location-test.wxml'), 'utf8')
  for (const tag of ['<map', '<live-player', '<live-pusher', '<camera']) assert(!wxml.includes(tag))
})
