'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { createLabBridge } = require('../tools/mini-location-tcp/lab-bridge')
const { createMediaMonitor } = require('../tools/mini-location-tcp/media-monitor')
const { createLabClient } = require('../miniprogram/services/device/lab')
const { createReceiver } = require('../tools/mini-location-tcp/receiver')
const { createMonitor } = require('../tools/mini-location-tcp/monitor')

function fixture(t) {
  let time = 1800000000000
  const now = () => time, peers = new Map(), events = new EventEmitter()
  const receiver = { events, snapshot: () => ({ connections: [...peers.values()], running: true }) }
  const media = createMediaMonitor(now), bridge = createLabBridge(receiver, media, { now })
  const connect = id => peers.set(id, { id, latest: null })
  const send = (id, extra = {}) => { const record = { longitude: 120.0001, latitude: 30.0001, receivedAt: time, framing: 'delimited', ...extra }; peers.get(id).latest = record; events.emit('event', { type: 'location', connectionId: id, record }) }
  const pair = (connectionId = null, coordinateSystem = 'UNKNOWN') => bridge.pair(bridge.configure({ confirm: true, connectionId, coordinateSystem }).code)
  t.after(() => { bridge.stop(); media.stop() })
  return { bridge, media, connect, send, pair, advance: n => { time += n }, disconnect: id => { peers.delete(id); events.emit('event', { type: 'disconnected', connectionId: id }) } }
}

test('lab pairing: single use, expiry, revocation, no secrets in monitor snapshot', t => {
  const f = fixture(t), b = f.bridge
  const p = b.configure({ confirm: true, coordinateSystem: 'UNKNOWN' })
  assert(!JSON.stringify(b.snapshot()).includes(p.code))
  const s = b.pair(p.code); b.authorize(s.token)
  assert.throws(() => b.pair(p.code), { code: 'PAIRING_INVALID' })
  assert(!JSON.stringify(b.snapshot()).includes(s.token))
  b.revoke(); assert.throws(() => b.authorize(s.token), { code: 'LAB_UNPAIRED' })
  const p2 = b.configure({ confirm: true, coordinateSystem: 'UNKNOWN' })
  f.advance(300001); assert.throws(() => b.pair(p2.code), { code: 'PAIRING_INVALID' })
  const s2 = f.pair(); f.advance(1800001); assert.throws(() => b.authorize(s2.token), { code: 'LAB_UNPAIRED' })
})
test('lab pairing: invalid source, brute force and missing confirmation rejected', t => {
  const { bridge: b } = fixture(t)
  assert.throws(() => b.configure({ coordinateSystem: 'WGS84' }), { code: 'CONFIRM_REQUIRED' })
  assert.throws(() => b.configure({ confirm: true, coordinateSystem: 'WGS84', connectionId: 'C99' }), { code: 'CONNECTION_GONE' })
  for (let i = 0; i < 10; i++) assert.throws(() => b.pair('BAD'), { code: 'PAIRING_INVALID' })
  assert.throws(() => b.pair('BAD'), { code: 'RATE_LIMIT' })
})
test('lab position: unknown CRS blocked; WGS84 converted once; no fabricated device fields', t => {
  const f = fixture(t); f.connect('C1'); f.send('C1'); f.pair('C1')
  assert.equal(f.bridge.dispatch('snapshot').point, null)
  f.pair('C1', 'WGS84')
  const w = f.bridge.dispatch('snapshot')
  assert.equal(w.status, 'lab-point'); assert(w.point.longitude > 120.001)
  for (const k of ['measuredAt', 'accuracyM', 'battery', 'deviceOnline', 'address']) assert.equal(w[k], null)
  assert.equal(w.productionReady, false); assert.equal(w.identityVerified, false)
  f.pair('C1', 'GCJ02')
  assert.equal(f.bridge.dispatch('snapshot').point.longitude, 120.0001)
})
test('lab position: expires, disconnect clears, replacement connection never selected automatically', t => {
  const f = fixture(t); f.connect('C1'); f.send('C1'); f.pair('C1', 'WGS84')
  f.advance(30000); assert.equal(f.bridge.dispatch('snapshot').status, 'stale'); assert.equal(f.bridge.dispatch('snapshot').point, null)
  f.disconnect('C1'); f.connect('C2'); f.send('C2')
  assert.equal(f.bridge.dispatch('snapshot').status, 'offline')
  assert.equal(f.bridge.dispatch('snapshot').point, null)
})
test('lab position: partial framing cannot produce a map point', t => {
  const f = fixture(t); f.connect('C1'); f.send('C1', { framing: 'provisional' }); f.pair('C1', 'WGS84')
  assert.equal(f.bridge.dispatch('snapshot').status, 'unframed'); assert.equal(f.bridge.dispatch('snapshot').point, null)
})
test('lab refresh: waits for NEW report on selected connection, not equal timestamp or other device', t => {
  const f = fixture(t); f.connect('C1'); f.connect('C2'); f.send('C1'); f.pair('C1', 'GCJ02')
  const query = () => f.bridge.dispatch('refresh', { requestId: 'r-1' })
  assert.equal(query().state, 'executing')
  f.send('C2'); assert.equal(query().state, 'executing')
  f.advance(5); f.send('C1'); assert.equal(query().state, 'success')
  assert.match(query().message, /非主动定位/)
  assert.equal(f.bridge.dispatch('refresh', { requestId: 'r-2' }).state, 'executing')
  f.advance(20000); assert.equal(f.bridge.dispatch('refresh', { requestId: 'r-2' }).state, 'timeout')
})
test('lab call: same id both ends, idempotent starts, busy, explicit progression, terminal is sticky', t => {
  const f = fixture(t); f.pair()
  const c = f.bridge.dispatch('call.start', { mediaType: 'video', requestId: 'c-1' })
  assert.equal(c.id, f.bridge.dispatch('call.start', { mediaType: 'video', requestId: 'c-1' }).id)
  assert.throws(() => f.bridge.dispatch('call.start', { mediaType: 'voice', requestId: 'c-2' }), { code: 'CALL_ACTIVE' })
  assert.throws(() => f.bridge.controlCall('connected', c.id), { code: 'INVALID_TRANSITION' })
  for (const step of ['ringing', 'accept', 'connected']) f.bridge.controlCall(step, c.id)
  assert.equal(f.bridge.dispatch('call.get').state, 'connected')
  assert.equal(f.bridge.dispatch('call.get').mediaReady, false)
  assert.equal(f.media.snapshot().sessions[0].simulated, true)
  assert.equal(f.media.snapshot().sessions[0].confirmed, false)
  f.bridge.dispatch('call.end', { callId: c.id })
  assert.throws(() => f.bridge.controlCall('connected', c.id), { code: 'CALL_NOT_ACTIVE' })
  assert.equal(f.bridge.dispatch('call.start', { mediaType: 'video', requestId: 'c-1' }).state, 'ended')
})
test('lab call: timeout, reject, interruption and expired pairing stop sessions', t => {
  const f = fixture(t); const s = f.pair()
  const c = f.bridge.dispatch('call.start', { mediaType: 'voice', requestId: 'c-1' })
  f.advance(30001); assert.equal(f.bridge.snapshot().call.endReason, 'NO_ANSWER')
  const c2 = f.bridge.dispatch('call.start', { mediaType: 'voice', requestId: 'c-2' })
  assert.throws(() => f.bridge.controlCall('end', c.id), { code: 'CALL_NOT_ACTIVE' })
  f.bridge.controlCall('rejected', c2.id); assert.equal(f.bridge.dispatch('call.get').endReason, 'REJECTED')
  const c3 = f.bridge.dispatch('call.start', { mediaType: 'video', requestId: 'c-3' })
  f.bridge.controlCall('interrupted', c3.id); assert.equal(f.bridge.dispatch('call.get').endReason, 'INTERRUPTED')
  f.bridge.dispatch('call.start', { mediaType: 'voice', requestId: 'c-4' }); f.bridge.revoke()
  assert.throws(() => f.bridge.authorize(s.token), { code: 'LAB_UNPAIRED' })
  assert.equal(f.bridge.snapshot().call.state, 'ended')
})
test('lab call: cancel before start, late responses and unrelated sessions are isolated', async t => {
  const f = fixture(t), requests = []
  const wx = wxStub({ request(o) { requests.push(o); return { abort() {} } } })
  const client = createLabClient({ wxApi: wx, store: storeStub() })
  const code = f.bridge.configure({ confirm: true, coordinateSystem: 'UNKNOWN' }).code
  function answer(o) {
    try {
      const action = o.url.split('/').pop()
      if (action !== 'pair') f.bridge.authorize(o.header['x-lab-token'])
      const data = action === 'pair' ? f.bridge.pair(o.data.code) : f.bridge.dispatch(action, o.data)
      o.success({ statusCode: 200, data: { ok: true, data } })
    } catch (error) { o.success({ statusCode: 400, data: { ok: false, error: { code: error.code, message: error.message } } }) }
  }
  const pairing = client.pair(code); answer(requests.shift()); await pairing
  const start = client.start('voice'), rejected = assert.rejects(start, { code: 'CALL_CANCELLED' })
  const lateStart = requests.shift()
  const stop = client.cleanup(); answer(requests.shift()); await stop
  answer(lateStart); await rejected
  assert.equal(f.bridge.dispatch('call.get'), null)
  const next = client.start('video'), nextRequest = requests.shift(); answer(nextRequest)
  const session = await next
  assert.equal(session.stage, 'calling')
  assert.equal(f.bridge.dispatch('call.end', { requestId: lateStart.data.requestId }), null)
  assert.equal(f.bridge.dispatch('call.get').state, 'calling')
  assert.equal(f.bridge.dispatch('call.end', {}), null)
  assert.equal(f.bridge.dispatch('call.get').state, 'calling')
  const oldQuery = client.getCall(), ignored = assert.rejects(oldQuery, { code: 'CANCELLED' }), slowQuery = requests.shift()
  const finish = client.cleanup(); answer(requests.shift()); await finish
  slowQuery.success({ statusCode: 200, data: { ok: true, data: session } }); await ignored
  const later = client.start('voice'), cancelled = assert.rejects(later, { code: 'CANCELLED' }), held = requests.shift()
  const delayedResponse = f.bridge.dispatch('call.start', held.data)
  const cancel = client.cleanup(); answer(requests.shift()); await cancel
  held.success({ statusCode: 200, data: { ok: true, data: delayedResponse } }); await cancelled
  assert.equal(f.bridge.dispatch('call.get').state, 'ended')
})

const storeStub = () => ({ getEpoch: () => 1, getSession: () => ({ privacyAccepted: true }) })
const wxStub = (patch = {}) => ({ getAccountInfoSync: () => ({ miniProgram: { appId: 'wxc5abf3407ed4ef30', envVersion: 'develop' } }), getDeviceInfo: () => ({ platform: 'devtools' }), ...patch })
test('lab client: refuses real phone, trial/release and wrong app before network', async () => {
  for (const patch of [
    { getDeviceInfo: () => ({ platform: 'ios' }) },
    { getAccountInfoSync: () => ({ miniProgram: { appId: 'wxc5abf3407ed4ef30', envVersion: 'release' } }) },
    { getAccountInfoSync: () => ({ miniProgram: { appId: 'wrong', envVersion: 'develop' } }) }
  ]) {
    const c = createLabClient({ wxApi: wxStub({ request() { assert.fail('Network must not run') }, ...patch }), store: storeStub() })
    await assert.rejects(c.pair('1234567890'), { code: 'LAB_DEVTOOLS_ONLY' })
  }
})
test('lab client: cancellation ignores slow reply and does not persist credential or coordinates', async () => {
  const requests = [], wx = wxStub({ request(o) { requests.push(o); return { abort() {} } }, setStorageSync() { assert.fail('No lab storage') } })
  const c = createLabClient({ wxApi: wx, store: storeStub() })
  const p = c.pair('1234567890')
  requests[0].success({ statusCode: 200, data: { ok: true, data: { token: 'a'.repeat(64), sessionId: 'test', expiresAt: Date.now() + 30000 } } }); await p
  const q = c.snapshot(); c.invalidate()
  requests[1].success({ statusCode: 200, data: { ok: true, data: { status: 'lab-point', point: { latitude: 30, longitude: 120 } } } })
  await assert.rejects(q, { code: 'CANCELLED' }); assert.equal(c.info().paired, false); assert.equal(c.isEnabled(), true)
  assert(requests.some(r => r.url.endsWith('/disconnect')))
})

test('lab HTTP + real TCP + client: complete local data and signalling path, permissions separated', async t => {
  const receiver = createReceiver({ port: 0 }), addr = await receiver.start()
  const monitor = createMonitor(receiver, { port: 0, tcpPort: addr.port, getTunnel: () => ({ active: false }) })
  const origin = await monitor.start(), html = await (await fetch(origin)).text()
  const ownerToken = /name="monitor-token" content="([a-f0-9]+)"/.exec(html)[1]
  const owner = async (path, data) => (await fetch(origin + path, { method: data ? 'POST' : 'GET', headers: { origin, 'x-monitor-token': ownerToken, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined })).json()
  const socket = net.connect(addr.port, addr.host)
  t.after(async () => { socket.destroy(); await monitor.stop(); await receiver.stop() })
  await new Promise(resolve => socket.once('connect', resolve))
  socket.write('120.0001_30.0001\r\n'); await delay(20)
  const state = await owner('/api/state'), id = state.connections[0].id
  const code = (await owner('/api/lab/pairing', { confirm: true, connectionId: id, coordinateSystem: 'WGS84' })).code
  let labToken
  const wx = wxStub({ request(o) {
    const controller = new AbortController()
    fetch(o.url.replace('http://127.0.0.1:18866', origin), { method: 'POST', headers: o.header, body: JSON.stringify(o.data), signal: controller.signal })
      .then(async r => { const data = await r.json(); if (data.data && data.data.token) labToken = data.data.token; o.success({ statusCode: r.status, data }) }).catch(o.fail)
    return { abort() { controller.abort() } }
  } })
  const client = createLabClient({ wxApi: wx, store: storeStub() })
  await client.pair(code)
  const loc = await client.snapshot(); assert(loc.point); assert.equal(loc.measuredAt, null); assert.equal(loc.productionReady, false)
  assert.equal((await fetch(origin + '/api/state', { headers: { 'x-monitor-token': labToken } })).status, 403)
  assert.equal((await fetch(origin + '/lab/v1/snapshot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lab-token': labToken, origin: 'https://evil.example' }, body: '{}' })).status, 403)
  assert.equal((await client.refresh()).state, 'executing')
  socket.write('120.0002_30.0002\r\n'); await delay(20); assert.equal((await client.refresh()).state, 'success')
  const call = await client.start('video')
  assert.equal(call.id, (await owner('/api/state')).lab.call.id)
  for (const action of ['ringing', 'accept', 'connected']) await owner('/api/lab/call', { action, callId: call.id })
  assert.equal((await client.getCall()).stage, 'connected')
  await client.cleanup(); assert.equal((await owner('/api/state')).lab.call.state, 'ended')
  socket.destroy(); await delay(20); assert.equal((await client.snapshot()).point, null)
  await owner('/api/lab/revoke', {})
  await assert.rejects(client.snapshot(), { code: 'LAB_UNPAIRED' })
  assert.equal(client.info().paired, false); assert.equal(client.isEnabled(), true)
})
