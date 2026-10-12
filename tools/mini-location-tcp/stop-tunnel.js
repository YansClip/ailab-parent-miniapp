'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const statusFile = path.join(__dirname, 'private', 'current-tunnel.json')

async function main() {
try {
  if (!fs.existsSync(statusFile)) {
    console.log('没有找到本项目的远程测试会话。')
  } else {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    if (status.state === 'closed') {
      console.log('远程测试已经关闭，无需重复停止。')
    } else {
      if (!Number.isSafeInteger(status.pid) || status.pid < 2) throw new Error('进程记录无效，请人工核对')
      let command
      try { command = execFileSync('/bin/ps', ['-p', String(status.pid), '-o', 'command='], { encoding: 'utf8' }) }
      catch (_) { throw new Error('记录中的进程已不在运行。请核对遗留锁，不会按旧 PID 误杀进程') }
      if (status.controller === 'monitor') {
        if (!command.includes('tools/mini-location-tcp/cli.js') || !Number.isInteger(status.monitorPort) || status.monitorPort < 1 || status.monitorPort > 65535) throw new Error('监控进程或端口不匹配')
        const origin = `http://127.0.0.1:${status.monitorPort}`
        const page = await fetch(origin, { signal: AbortSignal.timeout(3000) })
        const match = /name="monitor-token" content="([a-f0-9]{64})"/.exec(await page.text())
        if (!page.ok || !match) throw new Error('本机监控不可用')
        const response = await fetch(origin + '/api/tunnel/stop', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-monitor-token': match[1] }, body: '{}', signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error('窗口未确认公网关闭，请在窗口检查状态')
        console.log('公网已关闭；本机接收和监控窗口继续运行。')
        return
      }
      if (!/(?:^|\s)(?:\S*\/)?tools\/mini-location-tcp\/tunnel\.js(?:\s|$)/.test(command)) {
        throw new Error('PID 已不属于本接收工具，未执行停止')
      }
      process.kill(status.pid, 'SIGTERM')
      console.log('已请求关闭本项目的 TCP 穿透和接收程序。')
    }
  }
} catch (error) {
  console.error('未执行或未完成停止：' + error.message)
  process.exitCode = 1
}
}
main()
