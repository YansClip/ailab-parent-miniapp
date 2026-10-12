'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const { parseEndpoint, sshArgs, cleanText } = require('./tunnel')

// Owns ONLY an SSH TCP forwarder. The local receiver and dashboard stay alive.
function createTunnelController(options = {}) {
  const config = { directory: path.join(__dirname, 'private'), now: Date.now, spawn,
    setTimeout, clearTimeout, monitorPort: 18866, startupMs: 90000,
    prepareKey(directory) {
      const key = path.join(directory, 'pinggy-test-key')
      if (!fs.existsSync(key)) execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ailab-tcp-lab-only', '-f', key], { stdio: 'pipe' })
    }, ...options }
  let child = null
  let ownsLock = false
  let stopWork = null
  let expiryTimer, startupTimer
  const ownership = crypto.randomBytes(16).toString('hex')
  const lockPath = path.join(config.directory, 'tunnel.lock')
  const statusPath = path.join(config.directory, 'current-tunnel.json')
  let state = { state: 'closed', reason: '公网未开启', endpoint: null, expiresAt: null }
  function save() {
    fs.writeFileSync(statusPath, JSON.stringify({ ...state, pid: process.pid, receiverPid: process.pid,
      controller: 'monitor', monitorPort: config.monitorPort, syntheticOnly: true }, null, 2) + '\n', { mode: 0o600 })
  }
  function release() {
    if (!ownsLock) return
    try { if (fs.readFileSync(lockPath, 'utf8') === ownership) fs.unlinkSync(lockPath) } catch (_) {}
    ownsLock = false
  }
  function clearTimers() { config.clearTimeout(expiryTimer); config.clearTimeout(startupTimer) }
  function closed(reason) {
    clearTimers()
    state = { ...state, state: 'closed', reason, endpoint: null, closedAt: new Date(config.now()).toISOString() }
    try { save() } finally { release() }
    child = null
  }
  async function stop(reason = '已手动关闭公网；本机接收继续运行') {
    if (stopWork) return stopWork
    clearTimers()
    if (!child) { if (ownsLock) closed(reason); return }
    const target = child
    state = { ...state, state: 'stopping', reason: '正在关闭公网入口' }; save()
    stopWork = new Promise((resolve, reject) => {
      let forceTimer, deadline
      const onClose = () => { clearTimeout(forceTimer); clearTimeout(deadline); resolve() }
      target.once('close', onClose)
      target.kill('SIGTERM')
      forceTimer = setTimeout(() => target.kill('SIGKILL'), 1500)
      deadline = setTimeout(() => { target.off('close', onClose); reject(new Error('穿透进程未确认退出，请停止监控程序并核对进程')) }, 3000)
    })
    try { await stopWork; if (child === target || ownsLock) closed(reason) } finally { stopWork = null }
  }
  function start({ syntheticOnly, lifetimeMinutes = 30 } = {}) {
    if (syntheticOnly !== true) throw new Error('请确认仅发送合成测试数据')
    if (!Number.isInteger(lifetimeMinutes) || lifetimeMinutes < 1 || lifetimeMinutes > 55) throw new Error('测试时长须为 1–55 分钟')
    if (child || stopWork || ownsLock) throw new Error('公网正在开启或已开启，请勿重复启动')
    fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 })
    try { fs.writeFileSync(lockPath, ownership, { flag: 'wx', mode: 0o600 }); ownsLock = true }
    catch (_) { throw new Error('存在其他穿透会话或遗留锁，请先关闭原测试；不会覆盖或自动删除') }
    try {
      config.prepareKey(config.directory)
      state = { state: 'starting', reason: '正在申请临时公网地址', endpoint: null,
        startedAt: new Date(config.now()).toISOString(), expiresAt: new Date(config.now() + lifetimeMinutes * 60000).toISOString() }
      save()
      const current = config.spawn('/usr/bin/ssh', sshArgs(config.directory), { stdio: ['ignore', 'pipe', 'pipe'] })
      child = current
      let output = ''
      current.once('error', () => { if (child === current) closed('穿透程序启动失败，请检查 SSH 和网络') })
      current.once('close', () => { if (child === current) closed(state.state === 'stopping' ? '公网已关闭；本机接收继续运行' : '穿透已断开；不会自动重连') })
      const read = data => {
        if (child !== current || state.state !== 'starting') return
        output = (output + cleanText(data.toString())).slice(-8192)
        const endpoint = parseEndpoint(output)
        if (!endpoint) return
        config.clearTimeout(startupTimer)
        state = { ...state, endpoint, state: 'ready-unverified', reason: '地址已分配，硬件上传仍需核对' }; save()
      }
      current.stdout.on('data', read); current.stderr.on('data', read)
      const autoStop = reason => stop(reason).catch(() => { state.reason = '自动关闭未确认，请手动停止监控程序'; save() })
      startupTimer = config.setTimeout(() => autoStop('90 秒内未获得公网地址'), config.startupMs)
      expiryTimer = config.setTimeout(() => autoStop('测试时间已到，公网入口已关闭'), lifetimeMinutes * 60000)
    } catch (error) { if (!child) closed('启动失败'); throw error }
  }
  return { start, stop,
    snapshot() {
      const active = state.state === 'ready-unverified' && Date.parse(state.expiresAt) > config.now()
      return { active, managed: true, state: state.state, endpoint: active ? state.endpoint : null,
        expiresAt: active ? Date.parse(state.expiresAt) : null, reason: state.reason, syntheticOnly: true }
    }
  }
}
module.exports = { createTunnelController }
