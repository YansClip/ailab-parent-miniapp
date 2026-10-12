'use strict'
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const service = require('./service')
// Stop only the matching local receiver, never an arbitrary port owner.
try {
  if (service.installed()) service.control('stop')
  let output
  try { output = execFileSync('/usr/sbin/lsof', ['-t', '-iTCP:18866', '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch (_) { output = '' }
  const pids = [...new Set(output.trim().split(/\s+/).filter(Boolean))]
  if (!pids.length) console.log('本机监控已经停止。')
  for (const value of pids) {
    const pid = Number(value)
    if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('进程编号无效')
    const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
    const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n').find(line => line.startsWith('n'))?.slice(1)
    const absolute = path.join(__dirname, 'cli.js')
    const expected = command.includes(absolute) || (command.includes('tools/mini-location-tcp/cli.js') && cwd === path.resolve(__dirname, '../..'))
    if (!expected || !command.includes('--monitor')) throw new Error('端口被其他程序占用，不会停止它')
    process.kill(pid, 'SIGTERM')
    console.log('已通知本机接收和监控停止；如由远程测试启动，关联穿透也会关闭。')
  }
} catch (error) { console.error('未停止：' + error.message); process.exitCode = 1 }
