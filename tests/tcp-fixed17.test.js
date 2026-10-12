'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { setTimeout: delay } = require('node:timers/promises')
const { FrameDecoder, parseFrame } = require('../tools/mini-location-tcp/protocol')
const { createReceiver } = require('../tools/mini-location-tcp/receiver')
const { createMonitor } = require('../tools/mini-location-tcp/monitor')

const POINT = '120.0001_30.00010'
const REG = JSON.stringify({ imei: 'TEST-ONLY', info: { quoted: '}\\"{' }, csq: 20 })
function decode(chunks) {
  const frames = [], errors = []
  const d = new FrameDecoder({ mode: 'fixed17', onFrame: (f, boundary) => frames.push({ text: f.toString(), boundary }), onError: c => errors.push(c) })
  chunks.forEach(c => d.push(Buffer.from(c)))
  return { frames, errors, d }
}
async function until(fn) {
  for (let n = 0; n < 200; n++) { if (fn()) return; await delay(5) }
  assert.fail('等待事件超时')
}
test('fixed17: 注册 JSON 和多条坐标在任意字节边界拆分都能恢复', () => {
  const input = REG + POINT + POINT
  for (let i = 0; i <= input.length; i++) {
    const { frames, errors, d } = decode([input.slice(0, i), input.slice(i)])
    assert.deepEqual(errors, [])
    assert.deepEqual(frames.map(f => f.boundary), ['json-object', 'fixed17', 'fixed17'])
    assert.equal(frames[0].text, REG)
    assert.equal(frames[1].text, POINT)
    assert.equal(d.pendingBytes, 0)
  }
  assert.equal(decode([...input]).frames.length, 3)
})
test('fixed17: 无注册包、边界 CRLF、多个坐标粘包、末尾补零', () => {
  assert.equal(Buffer.byteLength(POINT), 17)
  const r = decode(['\r\n' + POINT + '\r', '\n' + POINT.repeat(50)])
  assert.equal(r.frames.length, 51)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(parseFrame(Buffer.from(POINT)), { kind: 'location', longitude: 120.0001, latitude: 30.0001 })
})
test('fixed17: 不足 17 字节等待，不使用静默时间猜坐标', () => {
  const r = decode([POINT.slice(0, -1)])
  r.d.flushProbe()
  assert.equal(r.frames.length, 0)
  assert.equal(r.d.pendingBytes, 16)
  r.d.push(Buffer.from('0'))
  assert.equal(r.frames.length, 1)
})
test('fixed17: 错位、符号、小数位错误、伪换行、再次注册失败后不重同步', () => {
  for (const input of ['120.00010_30.00010', '120.001_30.000100', '-120.0001_30.00010', 'GPS_' + POINT, ' ' + POINT, POINT + '\\r\\n', POINT + REG]) {
    const r = decode([input, POINT])
    assert.deepEqual(r.errors, ['FIXED_FORMAT'], input)
    assert.equal(r.d.failed, true)
    assert.equal(r.d.pendingBytes, 0)
    assert.ok(r.frames.length <= 1)
  }
})
test('fixed17: 注册 JSON 完整性、类型和长度限制', () => {
  assert.deepEqual(decode(['{"wrong":1}']).errors, ['UNSUPPORTED_JSON'])
  assert.deepEqual(decode(['{"imei":}']).errors, ['UNSUPPORTED_JSON'])
  assert.deepEqual(decode(['{"imei":"' + 'x'.repeat(513)]).errors, ['FRAME_TOO_LARGE'])
  assert.equal(decode(['{"imei":"unfinished']).frames.length, 0)
})
async function setup(t, extra = {}) {
  const receiver = createReceiver({ port: 0, framing: 'fixed17', ...extra })
  const events = []
  receiver.events.on('event', e => events.push(e))
  const address = await receiver.start()
  t.after(() => receiver.stop())
  const socket = net.connect(address.port, address.host)
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await new Promise(resolve => socket.once('connect', resolve))
  return { receiver, events, address, socket }
}
test('fixed17 socket: 注册不需要换行，不保存标识，坐标分片与合包，不回 ACK', async t => {
  const { receiver, events, socket } = await setup(t)
  let reply = ''; socket.on('data', d => { reply += d })
  socket.write(REG.slice(0, 12)); await delay(20)
  assert.equal(receiver.snapshot().stats.registration, 0)
  socket.write(REG.slice(12) + POINT.slice(0, 9)); await delay(20)
  assert.equal(receiver.snapshot().stats.registration, 1)
  assert.equal(receiver.snapshot().stats.parsed, 0)
  socket.write(POINT.slice(9) + POINT)
  await until(() => receiver.snapshot().stats.parsed === 2)
  const record = receiver.snapshot().connections[0].latest
  assert.equal(record.framing, 'fixed')
  assert.equal(record.boundary, 'fixed17')
  assert.equal(record.identityVerified, false)
  assert.equal(record.measuredAt, null)
  assert.equal(JSON.stringify(events).includes('TEST-ONLY'), false)
  assert.equal(reply, '')
})
test('fixed17 socket: 半包超时、坏格式和越界断开，不产生有效位置', async t => {
  for (const [value, code] of [[POINT.slice(0, -1), 'INCOMPLETE_FRAME'], ['{"imei":"unfinished', 'INCOMPLETE_FRAME'], ['120.00010_30.00010', 'FIXED_FORMAT'], ['181.0000_30.00000', 'OUT_OF_RANGE']]) {
    const { receiver, events, socket } = await setup(t, { partialTimeoutMs: 40, idleGapMs: 10 })
    socket.write(value)
    await until(() => events.some(e => e.type === 'disconnected'))
    assert.ok(events.some(e => e.code === code))
    assert.equal(receiver.snapshot().stats.parsed, 0)
  }
})
test('fixed17 socket: 可选 AUTH 仍使用换行，凭证不泄露', async t => {
  const token = 'fixed17-test-credential-only'
  const { receiver, events, socket } = await setup(t, { token })
  socket.write('AUTH ' + token + '\r\n' + REG + POINT)
  await until(() => receiver.snapshot().stats.parsed === 1)
  assert.equal(receiver.snapshot().connections[0].authenticated, true)
  assert.equal(JSON.stringify(events).includes(token), false)
})
test('fixed17 monitor: 模式、JSON 边界、自测正常与半包失败、小程序配对读取', async t => {
  const { receiver, address, socket } = await setup(t)
  const monitor = createMonitor(receiver, { port: 0, tcpPort: address.port, framing: 'fixed17' })
  t.after(() => monitor.stop())
  const origin = await monitor.start()
  const html = await (await fetch(origin)).text()
  const token = html.match(/name="monitor-token" content="([^"]+)"/)[1]
  const api = async (route, body) => (await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'x-monitor-token': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json()
  socket.write(REG + POINT)
  await until(() => receiver.snapshot().stats.parsed === 1)
  const state = await api('/api/state')
  assert.equal(state.receiver.framing, 'fixed17')
  assert.ok(state.events.some(e => e.boundary === 'json-object'))
  assert.ok(state.events.some(e => e.boundary === 'fixed17' && e.bytes === 17))
  assert.equal(JSON.stringify(state).includes('TEST-ONLY'), false)
  const pairing = await api('/api/lab/pairing', { confirm: true, connectionId: state.connections[0].id, coordinateSystem: 'WGS84' })
  const pair = await (await fetch(origin + '/lab/v1/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pairing.code }) })).json()
  assert.equal(pair.ok, true)
  const snapshot = await (await fetch(origin + '/lab/v1/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lab-token': pair.data.token }, body: '{}' })).json()
  assert.equal(snapshot.data.status, 'lab-point')
  await api('/api/test', { scene: 'registration' })
  assert.equal(receiver.snapshot().stats.parsed, 2)
  await api('/api/test', { scene: 'missing' })
  assert.ok(receiver.snapshot().stats.rejected > 0)
})
