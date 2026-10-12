const test = require('node:test')
const assert = require('node:assert/strict')
const { createCloudLocationCheck, projectCloudLocation, TEST_DEVICE_ID } = require('../miniprogram/services/device/cloud-location-check')
const scope = { familyId: 'synthetic-family', childId: 'synthetic-child', deviceId: TEST_DEVICE_ID, bindingVersion: 3 }
const time = 1800000000000
const snapshot = patch => ({ ...scope, online: true, serverTime: time, location: { displayable: true, status: 'valid', coordinateSystem: 'GCJ02', measuredAt: time, expiresAt: time + 15000, point: { longitude: 120.0001, latitude: 30.0001 } }, ...patch })
function fixture() {
  const state = { storageReady: true, locationProvider: 'push', rows: [{ ...scope, deviceName: '虚构测试设备 A', permissions: { viewDevice: true, locateDevice: true } }], snapshotCalls: 0 }
  const setup = { checkConnection: async () => state, bindings: async () => state.rows,
    locationSnapshot: async s => { state.snapshotCalls++; assert.equal(s.deviceId, TEST_DEVICE_ID); return snapshot() } }
  return { state, client: createCloudLocationCheck({ setup, clock: () => time }) }
}
test('手机云端检查只访问本人固定测试设备：未就绪、无绑定、无定位权限均不读取位置', async () => {
  const f = fixture()
  f.state.storageReady = false
  assert.equal((await f.client.inspect()).status, 'storage-pending')
  f.state.storageReady = true; f.state.rows = []
  assert.equal((await f.client.inspect()).status, 'unbound')
  f.state.rows = [{ ...scope, deviceId: 'other-real-device', permissions: { locateDevice: true } }]
  assert.equal((await f.client.inspect()).status, 'unbound')
  f.state.rows = [{ ...scope, permissions: { locateDevice: false } }]; f.state.locationProvider = 'disabled'
  const pending = await f.client.inspect()
  assert.equal(pending.status, 'provider-pending'); assert.equal(pending.locationAuthorized, false)
  f.state.locationProvider = 'push'
  assert.equal((await f.client.inspect()).status, 'permission-pending')
  assert.equal(f.state.snapshotCalls, 0)
  f.state.rows[0].permissions.locateDevice = true
  assert.equal((await f.client.inspect()).hasPoint, true); assert.equal(f.state.snapshotCalls, 1)
})
test('云端位置扣除请求耗时；跨绑定、缺采集时间、非法坐标拒绝；离线与过期清点', () => {
  assert.equal(projectCloudLocation(snapshot(), scope, time, time + 4000).remainingMs, 11000)
  assert.equal(projectCloudLocation(snapshot(), scope, time, time + 16000).hasPoint, false)
  assert.equal(projectCloudLocation(snapshot({ online: false }), scope, time, time).longitude, '—')
  const missing = snapshot(); missing.location.displayable = false; missing.location.point = null; missing.location.measuredAt = null
  missing.locationHint = '设备报文缺少 GPS 采集时间'
  const view = projectCloudLocation(missing, scope, time, time)
  assert.equal(view.hasPoint, false); assert.match(view.hint, /采集时间/)
  assert.throws(() => projectCloudLocation(snapshot({ bindingVersion: 2 }), scope, time, time), { code: 'INVALID_RESPONSE' })
  for (const patch of [{ measuredAt: null }, { point: { latitude: NaN, longitude: 120 } }, { coordinateSystem: 'UNKNOWN' }]) {
    const invalid = snapshot(); Object.assign(invalid.location, patch)
    assert.throws(() => projectCloudLocation(invalid, scope, time, time), { code: 'INVALID_RESPONSE' })
  }
})
test('手机检查页面：有效期到时清点、离页取消、迟到响应不恢复位置', async () => {
  const api = require('../miniprogram/services/api'), store = require('../miniprogram/services/store')
  const saved = { Page: global.Page, wx: global.wx, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, api: api.checkCloudTestLocation, session: store.getSession }
  let definition, seq = 0, mounted = true
  const timers = new Map()
  global.Page = value => { definition = value }; global.wx = { showToast() {} }
  global.setTimeout = (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id }
  global.clearTimeout = id => timers.delete(id)
  store.getSession = () => ({ privacyAccepted: true, loggedIn: true })
  const view = { ...projectCloudLocation(snapshot(), scope, time, time), deviceName: '虚构设备 A' }
  api.checkCloudTestLocation = async () => view
  try {
    delete require.cache[require.resolve('../miniprogram/pages/my/debug')]; require('../miniprogram/pages/my/debug')
    const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { assert(mounted); Object.assign(this.data, p) } }
    await page.checkCloudTestLocation()
    assert.equal(page.data.cloudLocation.hasPoint, true)
    const expiry = timers.get(page.cloudLocationExpiry); assert.equal(expiry.delay, 15000)
    timers.delete(page.cloudLocationExpiry); expiry.fn()
    assert.equal(page.data.cloudLocation.hasPoint, false); assert.equal(page.data.cloudLocation.longitude, '—')
    let finish
    api.checkCloudTestLocation = () => new Promise(resolve => { finish = resolve })
    const reading = page.checkCloudTestLocation()
    page.onHide(); mounted = false; finish(view); await reading
    assert.equal(page.data.cloudLocation, null); assert.equal(timers.size, 0)
  } finally { global.Page = saved.Page; global.wx = saved.wx; global.setTimeout = saved.setTimeout; global.clearTimeout = saved.clearTimeout; api.checkCloudTestLocation = saved.api; store.getSession = saved.session }
})
