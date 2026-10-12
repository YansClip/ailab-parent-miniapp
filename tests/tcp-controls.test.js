'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { createReceiver } = require('../tools/mini-location-tcp/receiver')
const { createMonitor } = require('../tools/mini-location-tcp/monitor')
const { createTunnelController } = require('../tools/mini-location-tcp/tunnel-controller')

async function setup(t, options = {}) {
  const receiver = createReceiver({ port: 0 })
  const address = await receiver.start()
  const monitor = createMonitor(receiver, { port: 0, tcpPort: address.port, getTunnel: () => ({ active: false }), ...options })
  const origin = await monitor.start()
  const html = await (await fetch(origin)).text()
  const token = /name="monitor-token" content="([a-f0-9]+)"/.exec(html)[1]
  const api = (route, body) => fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-monitor-token': token }, body: body === undefined ? undefined : JSON.stringify(body) })
  t.after(async () => { await monitor.stop(); await receiver.stop() })
  return { receiver, monitor, api, address, origin }
}
test('controls: stop disconnects TCP, leaves monitor/media alive, restart receives again', async t => {
  const { receiver, api, address } = await setup(t)
  const socket = net.connect(address.port, address.host)
  socket.on('error', () => {})
  t.after(() => socket.destroy())
  await new Promise(resolve => socket.once('connect', resolve))
  socket.write('120.0001_30.0001\r\n')
  await delay(25)
  await api('/api/reveal', { confirmLocalOnly: true })
  assert.equal((await api('/api/receiver/stop', {})).status, 200)
  let state = await (await api('/api/state')).json()
  assert.equal(state.receiver.running, false)
  assert.equal(state.connections.length, 0)
  assert.equal(state.revealUntil, 0)
  assert.equal((await api('/api/media/event', { callId: 'local', mediaType: 'voice', seq: 1, source: 'client', state: 'calling' })).status, 200)
  assert.equal((await api('/api/test', { scene: 'normal' })).status, 400)
  assert.equal((await api('/api/receiver/start', {})).status, 200)
  assert.equal((await api('/api/receiver/start', {})).status, 200)
  assert.equal((await api('/api/test', { scene: 'normal' })).status, 200)
  assert.equal(receiver.snapshot().stats.parsed, 2)
  state = await (await api('/api/state')).json()
  assert.equal(state.receiver.running, true)
})
test('controls: restarting on an occupied port fails truthfully and remains recoverable', async t => {
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  const receiver = createReceiver({ port })
  t.after(() => receiver.stop())
  await receiver.start(); await receiver.stop()
  const blocker = net.createServer()
  await new Promise(resolve => blocker.listen(port, '127.0.0.1', resolve))
  await assert.rejects(receiver.start(), { code: 'EADDRINUSE' })
  assert.equal(receiver.snapshot().running, false)
  await new Promise(resolve => blocker.close(resolve))
  await receiver.start()
  assert.equal(receiver.snapshot().running, true)
})
function controller(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ailab-tunnel-controls-'))
  let child
  const timers = []
  const instance = createTunnelController({ directory, prepareKey() {}, now: () => 10000,
    setTimeout(fn, ms) { const item = { fn, ms }; timers.push(item); return item }, clearTimeout(item) { if (item) item.cancelled = true },
    spawn(command, args) {
      assert.equal(command, '/usr/bin/ssh')
      assert.equal(args[args.indexOf('-R') + 1], '0:127.0.0.1:18765')
      assert.ok(!args.join(' ').includes('18866'))
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      child.kill = () => { process.nextTick(() => child.emit('close', 0)); return true }
      return child
    }
  })
  t.after(async () => { await instance.stop(); fs.rmSync(directory, { recursive: true }) })
  return { instance, directory, timers, get child() { return child } }
}
test('public controls: explicit consent, one tunnel, valid endpoint, stop and restart', async t => {
  const c = controller(t)
  assert.throws(() => c.instance.start({}), /合成/)
  assert.throws(() => c.instance.start({ syntheticOnly: true, lifetimeMinutes: 56 }), /1–55/)
  c.instance.start({ syntheticOnly: true, lifetimeMinutes: 15 })
  assert.equal(c.instance.snapshot().state, 'starting')
  assert.throws(() => c.instance.start({ syntheticOnly: true }), /重复/)
  c.child.stdout.emit('data', Buffer.from('tcp://test.run.pinggy-free.link:12345'))
  assert.equal(c.instance.snapshot().active, true)
  await c.instance.stop()
  assert.equal(c.instance.snapshot().active, false)
  assert.equal(c.instance.snapshot().endpoint, null)
  assert.equal(fs.existsSync(path.join(c.directory, 'tunnel.lock')), false)
  c.instance.start({ syntheticOnly: true, lifetimeMinutes: 1 })
  assert.equal(c.instance.snapshot().state, 'starting')
})
test('public controls: expiry closes SSH without reconnect and clears endpoint', async t => {
  const c = controller(t)
  c.instance.start({ syntheticOnly: true, lifetimeMinutes: 1 })
  c.child.stdout.emit('data', Buffer.from('tcp://test.run.pinggy-free.link:12345'))
  c.timers.find(timer => timer.ms === 60000).fn()
  await delay(10)
  assert.equal(c.instance.snapshot().state, 'closed')
  assert.equal(c.instance.snapshot().endpoint, null)
})
test('public controls: protects another session lock and handles startup failure', async t => {
  const c = controller(t)
  const lock = path.join(c.directory, 'tunnel.lock')
  fs.writeFileSync(lock, 'another-session')
  assert.throws(() => c.instance.start({ syntheticOnly: true }), /其他穿透/)
  assert.equal(fs.readFileSync(lock, 'utf8'), 'another-session')
  fs.unlinkSync(lock)
  c.instance.start({ syntheticOnly: true })
  c.child.emit('error', new Error('not available'))
  assert.equal(c.instance.snapshot().active, false)
  assert.equal(fs.existsSync(lock), false)
})
test('public API: requires consent and running receiver, stop preserves receiver and HTTP', async t => {
  let active = false
  const control = { snapshot: () => ({ managed: true, state: active ? 'starting' : 'closed', active: false }),
    start(body) { if (body.syntheticOnly !== true) throw new Error('确认合成数据'); active = true }, async stop() { active = false } }
  const { api, receiver } = await setup(t, { tunnelControl: control, tcpPort: 18765 })
  assert.equal((await api('/api/tunnel/start', {})).status, 409)
  assert.equal((await api('/api/tunnel/start', { syntheticOnly: true, lifetimeMinutes: 15 })).status, 200)
  assert.equal(active, true)
  assert.equal((await api('/api/tunnel/stop', {})).status, 200)
  assert.equal(receiver.snapshot().running, true)
  assert.equal((await api('/api/state')).status, 200)
  await api('/api/receiver/stop', {})
  assert.equal((await api('/api/tunnel/start', { syntheticOnly: true })).status, 409)
})
