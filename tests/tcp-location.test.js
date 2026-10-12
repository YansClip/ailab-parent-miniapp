'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const tls = require('node:tls')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')
const { parseFrame, FrameDecoder } = require('../tools/mini-location-tcp/protocol')
const { createReceiver } = require('../tools/mini-location-tcp/receiver')
const { formatEvent } = require('../tools/mini-location-tcp/cli')

const SAMPLE = '120.0001_30.0001'
const TOKEN = 'test-only-credential-not-a-production-secret'

async function until(predicate, timeout = 1500) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('等待测试事件超时')
    await delay(5)
  }
}

async function setup(t, options = {}) {
  const receiver = createReceiver({ port: 0, ...options })
  const events = []
  receiver.events.on('event', event => events.push(event))
  const address = await receiver.start()
  t.after(() => receiver.stop())
  return { receiver, events, address }
}

async function connect(t, address) {
  const socket = net.connect(address.port, address.host)
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
  return socket
}

test('TCP parser: 经度在前、纬度在后，不交换坐标，不猜坐标系', () => {
  assert.deepEqual(parseFrame(Buffer.from(SAMPLE)), { kind: 'location', longitude: 120.0001, latitude: 30.0001 })
  assert.equal(parseFrame(Buffer.from('-120.5_-30.5')).kind, 'location')
  for (const value of ['181_30', '120_91', '30_120', '0_0', 'NaN_30', '1e2_30', '120,30', '120_30junk', '120__30', '120_30\0', '120.0001_30.0001120.0001_30.0001']) {
    assert.equal(parseFrame(Buffer.from(value)).kind, 'invalid', value)
  }
})

test('TCP parser: 注册和心跳不冒充定位或认证，不保留设备号码', () => {
  const record = parseFrame(Buffer.from('{"imei":"private-identity","iccid":"private-sim","csq":20}'))
  assert.deepEqual(record, { kind: 'registration', identityVerified: false })
  assert.equal(JSON.stringify(record).includes('private'), false)
  assert.equal(parseFrame(Buffer.from('PING')).kind, 'heartbeat')
  assert.equal(parseFrame(Buffer.from('{"imei":"x","longitude":120}')).kind, 'invalid')
})

test('TCP framing: 拆包、CRLF、粘包及空帧；不会把 data 事件当一条消息', () => {
  const frames = []
  const decoder = new FrameDecoder({ onFrame: frame => frames.push(frame.toString()), onError: assert.fail })
  for (const chunk of ['120.0', '001_30.', '0001\r', '\n120.0002_30.0002\n\n']) decoder.push(Buffer.from(chunk))
  assert.deepEqual(frames, [SAMPLE + '\r', '120.0002_30.0002', ''])
  assert.equal(decoder.pendingBytes, 0)
})

test('TCP framing: 超长帧停止解析并清空，多个小帧不会误判超长', () => {
  const frames = []; const errors = []
  const decoder = new FrameDecoder({ maxFrameBytes: 16, onFrame: frame => frames.push(frame.toString()), onError: code => errors.push(code) })
  decoder.push(Buffer.from('120_30\n120_31\n120_32\n'))
  assert.equal(frames.length, 3)
  decoder.push(Buffer.alloc(17, 65))
  decoder.push(Buffer.from('120_30\n'))
  assert.deepEqual(errors, ['FRAME_TOO_LARGE'])
  assert.equal(frames.length, 3)
  assert.equal(decoder.pendingBytes, 0)
})

test('TCP config: 禁止公网监听、无效配置、弱口令和探测成功回包', () => {
  for (const options of [{ host: '0.0.0.0' }, { port: -1 }, { framing: 'packet' }, { ack: 'echo' },
    { token: 'short' }, { coordinateSystem: 'GPS' }, { framing: 'idle-probe', ack: 'ok' }, { maxFrameBytes: 0 }]) {
    assert.throws(() => createReceiver(options))
  }
})

test('TCP socket: 真正通过 socket 收到两条拆/粘包，时间及身份未知不伪造', async t => {
  const { receiver, events, address } = await setup(t)
  const socket = await connect(t, address)
  socket.write('120.000')
  await delay(20)
  assert.equal(receiver.snapshot().stats.parsed, 0)
  socket.write('1_30.0001\r\n120.0002_30.0002\n')
  await until(() => receiver.snapshot().stats.parsed === 2)
  const record = events.find(event => event.type === 'location').record
  assert.equal(record.measuredAt, null)
  assert.equal(record.coordinateSystem, 'UNKNOWN')
  assert.equal(record.deviceId, null)
  assert.equal(record.accuracyM, null)
  assert.equal(record.displayable, false)
  assert.equal(record.identityVerified, false)
  assert.ok(record.receivedAt > 0)
})

test('TCP socket: 默认不回包，非法数据不会覆盖最后一条格式正确记录', async t => {
  const { receiver, events, address } = await setup(t)
  const socket = await connect(t, address)
  let response = ''
  socket.on('data', data => { response += data.toString() })
  socket.write(SAMPLE + '\n181_30\n')
  await until(() => events.some(event => event.code === 'OUT_OF_RANGE'))
  assert.equal(receiver.snapshot().connections[0].latest.longitude, 120.0001)
  await delay(30)
  assert.equal(response, '')
})

test('TCP socket: 无结束符严格等待，断开时不接受残留半包', async t => {
  const { receiver, events, address } = await setup(t, { idleGapMs: 15 })
  const socket = await connect(t, address)
  socket.write(SAMPLE)
  await until(() => events.some(event => event.type === 'awaiting-newline'))
  assert.equal(receiver.snapshot().stats.parsed, 0)
  socket.end()
  await until(() => events.some(event => event.type === 'disconnected'))
  assert.ok(events.some(event => event.code === 'INCOMPLETE_FRAME'))
  assert.equal(receiver.snapshot().connections.length, 0)
})

test('TCP socket: 无换行空闲探测只能产生候选，慢半包永不晋升为正式定位', async t => {
  const { receiver, events, address } = await setup(t, { framing: 'idle-probe', idleGapMs: 15 })
  const socket = await connect(t, address)
  socket.write('120.0001_30.0')
  await until(() => events.some(event => event.type === 'candidate'))
  socket.write('001\n')
  await until(() => events.some(event => event.type === 'rejected'))
  socket.write(SAMPLE + '\n')
  await until(() => receiver.snapshot().stats.provisional === 2)
  assert.equal(receiver.snapshot().stats.parsed, 0)
  assert.equal(receiver.snapshot().connections[0].latest.displayable, false)
})

test('TCP socket: 只有显式开启 ACK 才回应 OK，坏包和注册包不回应', async t => {
  const { events, address } = await setup(t, { ack: 'ok' })
  const socket = await connect(t, address)
  let response = ''
  socket.on('data', data => { response += data.toString() })
  socket.write(SAMPLE + '\n{"imei":"test"}\ninvalid\n')
  await until(() => response === 'OK\r\n' && events.some(event => event.type === 'rejected'))
  await delay(20)
  assert.equal(response, 'OK\r\n')
})

test('TCP auth: 未认证上报拒绝，握手拆包成功；口令不出现在事件和展示中', async t => {
  const { receiver, events, address } = await setup(t, { token: TOKEN })
  const denied = await connect(t, address)
  denied.write(SAMPLE + '\n')
  await until(() => events.some(event => event.code === 'AUTH_FAILED'))
  assert.equal(receiver.snapshot().stats.parsed, 0)
  const allowed = await connect(t, address)
  allowed.write('AUTH ' + TOKEN.slice(0, 8))
  await delay(10)
  allowed.write(TOKEN.slice(8) + '\r\n' + SAMPLE + '\n')
  await until(() => receiver.snapshot().stats.parsed === 1)
  assert.equal(JSON.stringify(events).includes(TOKEN), false)
  const record = events.find(event => event.type === 'location').record
  assert.equal(record.authentication, 'lab-shared-token')
  assert.equal(record.identityVerified, false)
})

test('TCP auth: 长度相同错误口令、无认证等待都被断开', async t => {
  const { receiver, events, address } = await setup(t, { token: TOKEN, authTimeoutMs: 40 })
  const bad = await connect(t, address)
  bad.write('AUTH ' + TOKEN.replace(/^t/, 'x') + '\n')
  await until(() => events.some(event => event.code === 'AUTH_FAILED'))
  await connect(t, address)
  await until(() => events.some(event => event.code === 'AUTH_TIMEOUT'))
  assert.equal(receiver.snapshot().stats.parsed, 0)
})

test('TCP retention: 多连接隔离、到期和断开清理；不产生轨迹集合', async t => {
  let now = 100000
  const { receiver, address } = await setup(t, { now: () => now, retentionMs: 100 })
  const a = await connect(t, address)
  const b = await connect(t, address)
  a.write(SAMPLE + '\n'); b.write('121_31\n')
  await until(() => receiver.snapshot().stats.parsed === 2)
  const records = receiver.snapshot().connections
  assert.equal(records.length, 2)
  assert.notEqual(records[0].latest.longitude, records[1].latest.longitude)
  now += 101
  assert.ok(receiver.snapshot().connections.every(peer => peer.latest === null))
  a.destroy(); b.destroy()
  await until(() => receiver.snapshot().connections.length === 0)
})

test('TCP limits: 超长帧、突发帧、突发字节均受限制', async t => {
  for (const [options, message, code] of [
    [{ maxFrameBytes: 20 }, 'x'.repeat(21), 'FRAME_TOO_LARGE'],
    [{ maxFramesPerSecond: 2 }, '120_30\n'.repeat(3), 'RATE_LIMIT'],
    [{ maxBytesPerSecond: 10 }, SAMPLE + '\n', 'BYTE_RATE_LIMIT']
  ]) {
    const { events, address } = await setup(t, options)
    const socket = await connect(t, address)
    socket.write(message)
    await until(() => events.some(event => event.code === code))
    await until(() => events.some(event => event.type === 'disconnected'))
  }
})

test('TCP limits: 半包超时、连接空闲超时均会关闭', async t => {
  const partial = await setup(t, { partialTimeoutMs: 30 })
  const a = await connect(t, partial.address)
  a.write('120.')
  await until(() => partial.events.some(event => event.code === 'INCOMPLETE_FRAME'))
  const idle = await setup(t, { socketTimeoutMs: 30 })
  await connect(t, idle.address)
  await until(() => idle.events.some(event => event.code === 'SOCKET_IDLE'))
})

test('TCP lifecycle: 停止释放监听和客户端，端口可重新使用', async t => {
  const { receiver, address } = await setup(t)
  const socket = await connect(t, address)
  socket.write(SAMPLE + '\n')
  await until(() => receiver.snapshot().stats.parsed === 1)
  await receiver.stop()
  const next = createReceiver({ port: address.port })
  t.after(() => next.stop())
  await next.start()
  assert.equal(receiver.snapshot().connections.length, 0)
})

test('TCP limits: 多余连接及连续重连受限，限额外报文不能产生位置', async t => {
  const { receiver, events, address } = await setup(t, { maxConnections: 1, maxConnectionsPerMinute: 2 })
  const first = await connect(t, address)
  const second = await connect(t, address)
  second.write(SAMPLE + '\n')
  await until(() => events.some(event => event.code === 'CONNECTION_LIMIT'))
  assert.equal(receiver.snapshot().connections.length, 1)
  assert.equal(receiver.snapshot().stats.parsed, 0)
  first.destroy()
  await until(() => receiver.snapshot().connections.length === 0)
  const third = await connect(t, address)
  third.write(SAMPLE + '\n')
  await until(() => events.filter(event => event.code === 'CONNECTION_LIMIT').length === 2)
  assert.equal(receiver.snapshot().stats.parsed, 0)
})

test('TCP lifecycle: 端口冲突明确失败；并发重复启动被拒绝', async t => {
  const { address } = await setup(t)
  const collision = createReceiver({ port: address.port })
  await assert.rejects(collision.start(), { code: 'EADDRINUSE' })
  await collision.stop()
  const receiver = createReceiver({ port: 0 })
  t.after(() => receiver.stop())
  const started = receiver.start()
  await assert.rejects(receiver.start(), /已经启动/)
  await started
})

test('TCP CLI: 默认输出不含坐标，明确启用后才能显示；无虚构定位成功', () => {
  const event = { type: 'location', at: 100000, connectionId: 'C1', record: { longitude: 120.0001, latitude: 30.0001 } }
  assert.equal(formatEvent(event).includes('120.0001'), false)
  assert.equal(formatEvent(event, true).includes('120.0001'), true)
  assert.ok(formatEvent(event).includes('未确认定位有效性'))
  assert.ok(formatEvent({ ...event, type: 'candidate' }).includes('分包未确认'))
})

test('TCP TLS: 真实加密 socket、证书校验和口令握手收取合成坐标', async t => {
  // Generated test-only key/certificate, outside the repo; removed after test.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ailab-tcp-tls-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const cert = path.join(directory, 'cert.pem')
  const key = path.join(directory, 'key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'pipe' })
  const { receiver, address } = await setup(t, { token: TOKEN, tls: { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } })
  const socket = tls.connect({ host: address.host, port: address.port, servername: 'localhost', ca: fs.readFileSync(cert) })
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject) })
  assert.equal(socket.authorized, true)
  socket.write('AUTH ' + TOKEN + '\n' + SAMPLE + '\n')
  await until(() => receiver.snapshot().stats.parsed === 1)
})
