'use strict'

const fs = require('node:fs')
const { parseArgs } = require('node:util')
const { createReceiver } = require('./receiver')
const { createMonitor } = require('./monitor')

function formatEvent(event, showCoordinates = false) {
  const time = new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })
  const prefix = '[' + time + '] ' + (event.connectionId || '服务') + ' '
  const messages = {
    connected: '已连接（不是设备身份验证）', authenticated: '测试口令通过（不是正式设备绑定）',
    disconnected: '已断开，已清除本次连接的位置', expired: '接收记录已过展示保留期，已清除坐标',
    registration: '收到注册信息，未保存设备标识，也未据此认证', heartbeat: '收到 PING 心跳',
    'awaiting-newline': '已收到字节，正在等换行符；不能按完整定位确认',
    'awaiting-frame': '正在等待完整注册 JSON 或剩余的 17 字节定位报文',
    'socket-error': '连接发生异常', 'server-error': '服务发生异常'
  }
  if (event.type === 'location' || event.type === 'candidate') {
    const lead = event.type === 'candidate' ? '探测到疑似坐标【分包未确认】' : '收到完整坐标，格式校验通过'
    const coords = showCoordinates ? `；经度 ${event.record.longitude}，纬度 ${event.record.latitude}` : '；坐标默认隐藏'
    return prefix + lead + coords + '；未接入小程序、未确认定位有效性'
  }
  if (event.type === 'rejected') return prefix + '未接收为有效记录：' + event.code
  return prefix + (messages[event.type] || event.type)
}

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '18765' }, framing: { type: 'string', default: 'fixed17' },
    ack: { type: 'string', default: 'none' }, 'coordinate-system': { type: 'string', default: 'UNKNOWN' },
    'idle-gap-ms': { type: 'string', default: '1000' },
    monitor: { type: 'boolean', default: false }, 'monitor-port': { type: 'string', default: '18866' },
    'open-monitor': { type: 'boolean', default: false },
    'show-coordinates': { type: 'boolean', default: false }, help: { type: 'boolean' }
  } })
  if (values.help) {
    console.log('用法：npm run device:tcp -- [--port 18765] [--framing fixed17|line|idle-probe] [--ack none|ok] [--coordinate-system UNKNOWN|WGS84|GCJ02] [--idle-gap-ms 1000] [--show-coordinates]')
    console.log('可加 --monitor 启动本机监控窗口；--open-monitor 同时打开浏览器；--monitor-port 默认 18866。')
    console.log('默认只监听本机、固定 17 字节坐标＋可选开机注册 JSON、不回包、不保存文件、不输出坐标。说明：docs/MINI-TCP-FIXED17.md')
    return
  }
  const cert = process.env.MINI_TCP_TLS_CERT
  const key = process.env.MINI_TCP_TLS_KEY
  if (Boolean(cert) !== Boolean(key)) throw new Error('TLS 证书和私钥路径必须同时配置')
  const receiver = createReceiver({
    port: Number(values.port), framing: values.framing, ack: values.ack,
    coordinateSystem: values['coordinate-system'], idleGapMs: Number(values['idle-gap-ms']),
    token: process.env.MINI_TCP_TOKEN || '',
    tls: cert ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : null
  })
  receiver.events.on('event', event => console.log(formatEvent(event, values['show-coordinates'])))
  const address = await receiver.start()
  let monitor
  try {
    if (values.monitor || values['open-monitor']) {
      const monitorPort = Number(values['monitor-port'])
      if (!Number.isInteger(monitorPort) || monitorPort < 1 || monitorPort > 65535) throw new Error('监控端口无效')
      monitor = createMonitor(receiver, { port: monitorPort, tcpPort: address.port, framing: values.framing,
        ack: values.ack, coordinateSystem: values['coordinate-system'], secured: Boolean(cert || process.env.MINI_TCP_TOKEN), enableTunnelControls: true })
      const url = await monitor.start()
      console.log('本机可视化监控：' + url + '（不要公开此 HTTP 端口）')
      if (values['open-monitor'] && process.platform === 'darwin') {
        const child = require('node:child_process').spawn('/usr/bin/open', [url], { stdio: 'ignore' })
        child.on('error', () => console.log('请手动打开本机监控网址。'))
      }
    }
  } catch (error) { if (monitor) await monitor.stop(); await receiver.stop(); throw error }
  console.log('\nAILab mini 定位接收工具 · 仅用于联调')
  console.log(`本机 ${address.tls ? 'TLS' : 'TCP'} 接收地址：${address.host}:${address.port}`)
  console.log('这是本机地址，不是给远程工程师的公网地址，也不能用浏览器打开。')
  console.log(`分包模式：${values.framing}；回包：${values.ack}；坐标系：${values['coordinate-system']}`)
  console.log(`测试口令：${process.env.MINI_TCP_TOKEN ? '已启用，需要 AUTH 握手' : '未启用，仅限本机可信测试'}`)
  console.log('本程序不会自行开启公网穿透；真实位置跨公网前必须确认设备认证和全程加密。')
  if (values.framing === 'idle-probe') console.log('注意：无换行探测依赖空闲间隔，可能把半条消息误判为候选。只排查收字节，不用于正式定位或成功回包。')
  if (values['show-coordinates']) console.log('已主动开启坐标显示；请勿录屏转发、重定向日志或使用儿童位置。')
  console.log('等待设备…… 按 Ctrl+C 停止。\n')
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    const stats = receiver.snapshot().stats
    if (monitor) await monitor.stop()
    await receiver.stop()
    console.log(`\n已停止。完整坐标 ${stats.parsed} 条；探测候选 ${stats.provisional} 条；拒绝 ${stats.rejected} 次。未保存位置文件。`)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

if (require.main === module) main().catch(error => {
  console.error(error.code === 'EADDRINUSE' ? '端口已被占用。请停止旧接收程序，或使用 --port 18766。' : '启动失败：' + error.message)
  process.exitCode = 1
})

module.exports = { formatEvent }
