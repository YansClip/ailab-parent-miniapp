'use strict'

// One deliberately short-lived synthetic-data lab session. Does not expose
// SSH, files, Mini Program services or a browser debugger; only port 18765.
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { parseArgs } = require('node:util')

const privateDir = path.join(__dirname, 'private')
const statusFile = path.join(privateDir, 'current-tunnel.json')

function parseEndpoint(text) {
  // The provider currently uses both legacy pinggy.link and pinggy-free.link.
  const match = /tcp:\/\/([a-z0-9.-]+\.(?:pinggy|pinggy-free)\.link):(\d{1,5})\b/i.exec(text)
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) return null
  return { host: match[1].toLowerCase(), port: Number(match[2]) }
}

function sshArgs(directory) {
  return [
    '-F', '/dev/null', '-T', '-p', '443',
    '-i', path.join(directory, 'pinggy-test-key'),
    '-o', 'UserKnownHostsFile=' + path.join(directory, 'known_hosts'),
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'BatchMode=yes',
    '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=15',
    '-R', '0:127.0.0.1:18765', 'tcp@free.pinggy.io'
  ]
}

function cleanText(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[^\x20-\x7E\n\r\t\u0080-\uFFFF]/g, '')
}

async function main() {
  const { values } = parseArgs({ options: {
    'synthetic-only': { type: 'boolean', default: false },
    'lifetime-minutes': { type: 'string', default: '55' },
    framing: { type: 'string', default: 'fixed17' }, help: { type: 'boolean' }
  } })
  if (values.help) {
    console.log('node tools/mini-location-tcp/tunnel.js --synthetic-only [--lifetime-minutes 55] [--framing fixed17|line|idle-probe]')
    console.log('只向第三方暴露本地接收程序，默认 55 分钟关闭；不自动重连，不使用个人 SSH 密钥。')
    return
  }
  if (!values['synthetic-only']) throw new Error('未确认设备端加密，仅允许 --synthetic-only 合成数据测试')
  const lifetime = Number(values['lifetime-minutes'])
  if (!Number.isInteger(lifetime) || lifetime < 1 || lifetime > 55) throw new Error('临时测试时间须为 1–55 分钟')
  if (!['line', 'idle-probe', 'fixed17'].includes(values.framing)) throw new Error('分包模式无效')
  // This launcher does not silently forward real-location/TLS credentials from
  // another shell setup into a plaintext test session.
  if (process.env.MINI_TCP_TOKEN || process.env.MINI_TCP_TLS_CERT || process.env.MINI_TCP_TLS_KEY) {
    throw new Error('检测到独立认证/TLS 配置，请使用专用安全接入方案，不混用此合成数据穿透入口')
  }
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 })
  const lockPath = path.join(privateDir, 'tunnel.lock')
  let lock
  try { lock = fs.openSync(lockPath, 'wx', 0o600) } catch (error) {
    if (error.code === 'EEXIST') throw new Error('已有穿透会话或上次异常退出的锁。先核对 current-tunnel.json 中的进程，不要并行启动或盲目删除锁。')
    throw error
  }
  fs.closeSync(lock)
  const state = {
    state: 'starting', pid: process.pid, localHost: '127.0.0.1', localPort: 18765,
    provider: 'Pinggy free', syntheticOnly: true, framing: values.framing, ack: 'none',
    coordinateSystem: 'UNKNOWN', endpoint: null, startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + lifetime * 60000).toISOString()
  }
  const save = () => fs.writeFileSync(statusFile, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  let receiver
  let ssh
  let closing = false
  let expireTimer
  let startupTimer
  function stop(reason, code = 0) {
    if (closing) return
    closing = true
    clearTimeout(expireTimer)
    clearTimeout(startupTimer)
    state.state = 'closed'
    state.closedAt = new Date().toISOString()
    state.reason = reason
    save()
    // Stop public reachability first. Kill only children of this session.
    if (ssh && ssh.exitCode === null) ssh.kill('SIGTERM')
    if (receiver && receiver.exitCode === null) receiver.kill('SIGTERM')
    console.log('\n测试入口已关闭：' + reason)
    const force = setTimeout(() => {
      if (ssh && ssh.exitCode === null) ssh.kill('SIGKILL')
      if (receiver && receiver.exitCode === null) receiver.kill('SIGKILL')
    }, 2000)
    force.unref()
    process.exitCode = code
  }
  process.once('exit', () => { try { fs.unlinkSync(lockPath) } catch (_) {} })
  process.once('SIGINT', () => stop('手动停止'))
  process.once('SIGTERM', () => stop('手动停止'))
  try {
    save()
    const keyFile = path.join(privateDir, 'pinggy-test-key')
    if (!fs.existsSync(keyFile)) {
      execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ailab-tcp-lab-only', '-f', keyFile], { stdio: 'pipe' })
    }
    console.log('正在准备临时 TCP 入口，仅限合成数据；最长 ' + lifetime + ' 分钟，到期不自动重连。')
    expireTimer = setTimeout(() => stop('测试时限已到'), lifetime * 60000)
    startupTimer = setTimeout(() => stop('90 秒内未获得公网地址', 1), 90000)
    receiver = spawn(process.execPath, [path.join(__dirname, 'cli.js'), '--framing', values.framing, '--monitor', '--open-monitor'], { stdio: ['ignore', 'pipe', 'pipe'] })
    state.receiverPid = receiver.pid
    save()
    receiver.once('error', () => stop('接收程序启动失败', 1))
    receiver.once('close', () => { if (!closing) stop('接收程序已退出', 1) })
    receiver.stderr.on('data', data => process.stderr.write(cleanText(data.toString())))
    let readyBuffer = ''
    receiver.stdout.on('data', data => {
      const text = cleanText(data.toString())
      process.stdout.write(text)
      readyBuffer = (readyBuffer + text).slice(-4096)
      if (closing || ssh || !readyBuffer.includes('等待设备')) return
      console.log('\n正在连接 Pinggy，只转发 18765 端口……')
      ssh = spawn('/usr/bin/ssh', sshArgs(privateDir), { stdio: ['ignore', 'pipe', 'pipe'] })
      ssh.once('error', () => stop('SSH 穿透启动失败', 1))
      ssh.once('close', () => { if (!closing) stop('穿透服务断开或到期', 1) })
      let output = ''
      const read = data => {
        const chunk = cleanText(data.toString())
        process.stdout.write(chunk)
        output = (output + chunk).slice(-8192)
        const endpoint = parseEndpoint(output)
        if (closing || !endpoint || state.endpoint) return
        state.endpoint = endpoint
        state.state = 'ready-unverified'
        save()
        clearTimeout(startupTimer)
        console.log(`\n公网 TCP 地址：${endpoint.host}\n公网端口：${endpoint.port}`)
        console.log('到期时间：' + new Date(state.expiresAt).toLocaleString('zh-CN', { hour12: false }))
        console.log('尚需从公网发送合成坐标验证；不能把获得地址当作硬件联调成功。')
        console.log('只能发送合成坐标，不上传儿童/个人真实位置。Ctrl+C 同时关闭接收和穿透。')
      }
      ssh.stdout.on('data', read)
      ssh.stderr.on('data', read)
    })
  } catch (error) {
    stop('启动失败：' + error.message, 1)
  }
}

if (require.main === module) main().catch(error => {
  console.error('无法启动：' + error.message)
  process.exitCode = 1
})

module.exports = { parseEndpoint, sshArgs, cleanText }
