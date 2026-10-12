'use strict'

// Synthetic samples only. This simulator deliberately cannot target a public
// hostname; never use it to probe the engineer's third-party TCP test service.
const net = require('node:net')
const tls = require('node:tls')
const fs = require('node:fs')
const { parseArgs } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '18765' }, scenario: { type: 'string', default: 'normal' },
    seconds: { type: 'string', default: '300' },
    framing: { type: 'string', default: 'fixed17' },
    tls: { type: 'boolean', default: false }, help: { type: 'boolean' }
  } })
  if (values.help) {
    console.log('用法：npm run device:tcp:send -- [--port 18765] [--framing fixed17|line] [--scenario normal|split|sticky|invalid|no-newline|registration|stream] [--seconds 300] [--tls]')
    return
  }
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  if (!['fixed17', 'line'].includes(values.framing)) throw new Error('发送模式必须是 fixed17 或 line')
  const fixed = values.framing === 'fixed17'
  const scenarios = fixed ? {
    normal: ['120.0000_30.00000', '120.0001_30.00010'],
    split: ['120.00', '02_30.', '00020'],
    sticky: ['120.0003_30.00030120.0004_30.00040'],
    invalid: ['120.000_30.000000'],
    'no-newline': ['120.0005_30.00050'],
    registration: ['{"imei":"TEST-DEVICE-NOT-REAL","csq":20}', '120.0006_30.00060']
  } : {
    normal: ['120.0000_30.0000\r\n', '120.0001_30.0001\r\n'],
    split: ['120.00', '02_30.', '0002\r', '\n'],
    sticky: ['120.0003_30.0003\n120.0004_30.0004\n'],
    invalid: ['not-a-location\n', '181_30\n', '120_91\n', '0_0\n'],
    'no-newline': ['120.0005_30.0005'],
    registration: ['{"imei":"TEST-DEVICE-NOT-REAL","csq":20}\r\n', '120.0006_30.0006\r\n']
  }
  if (!scenarios[values.scenario] && values.scenario !== 'stream') throw new Error('未知场景')
  const seconds = Number(values.seconds)
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 1800) throw new Error('持续时长应为 5–1800 秒')
  const connectionOptions = { host: '127.0.0.1', port }
  if (values.tls) {
    if (!process.env.MINI_TCP_TLS_CA || !process.env.MINI_TCP_TLS_SERVERNAME) {
      throw new Error('TLS 测试需设置 MINI_TCP_TLS_CA 和 MINI_TCP_TLS_SERVERNAME，不跳过证书校验')
    }
    Object.assign(connectionOptions, { ca: fs.readFileSync(process.env.MINI_TCP_TLS_CA), servername: process.env.MINI_TCP_TLS_SERVERNAME })
  }
  const socket = values.tls ? tls.connect(connectionOptions) : net.connect(connectionOptions)
  socket.setTimeout(5000, () => socket.destroy(new Error('连接超时')))
  socket.on('data', data => console.log('收到服务端回复：' + (data.toString() === 'OK\r\n' ? 'OK' : `非标准回包（${data.length} 字节）`)))
  let failure
  socket.on('error', error => { failure = error })
  const closed = new Promise(resolve => socket.once('close', resolve))
  try {
    await new Promise((resolve, reject) => {
      socket.once(values.tls ? 'secureConnect' : 'connect', resolve)
      socket.once('error', reject)
    })
    if (process.env.MINI_TCP_TOKEN) socket.write('AUTH ' + process.env.MINI_TCP_TOKEN + '\n')
    if (values.scenario === 'stream') {
      console.log('开始本机合成坐标流，每 3 秒一条；不是硬件上报。可在联调台选择该连接后配对。Ctrl+C 停止。')
      for (let n = 0; n < Math.ceil(seconds / 3); n++) {
        if (failure || socket.destroyed) throw failure || new Error('连接被服务端关闭')
        const offset = (n % 4) / 10000
        socket.write((120 + offset).toFixed(4) + '_' + (30 + offset).toFixed(fixed ? 5 : 4) + (fixed ? '' : '\r\n'))
        await delay(3000)
      }
    }
    for (const chunk of scenarios[values.scenario] || []) {
      if (failure || socket.destroyed) throw failure || new Error('连接被服务端关闭')
      socket.write(chunk)
      await delay(120)
    }
    await delay(values.scenario === 'no-newline' ? 1400 : 300)
    if (failure || socket.destroyed) throw failure || new Error('连接被服务端关闭')
    console.log('模拟数据发送完成；请在接收端确认结果。写入 socket 不等于服务端已解析成功。')
  } finally {
    socket.end()
    const forceClose = setTimeout(() => socket.destroy(), 1000)
    await closed
    clearTimeout(forceClose)
  }
  if (failure) throw failure
}

if (require.main === module) main().catch(error => {
  console.error('发送失败：' + error.message)
  process.exitCode = 1
})
