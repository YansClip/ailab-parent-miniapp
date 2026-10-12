'use strict'

const fs = require('node:fs')
const { parseArgs } = require('node:util')

async function sendEvent(event, port = 18866) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效')
  // This helper runs on the same computer only. It is not a public collector.
  const origin = `http://127.0.0.1:${port}`
  const page = await fetch(origin, { signal: AbortSignal.timeout(3000) })
  if (!page.ok) throw new Error('本机监控未开启')
  const match = /name="monitor-token" content="([a-f0-9]{64})"/.exec(await page.text())
  if (!match) throw new Error('无法确认本机监控服务')
  const response = await fetch(origin + '/api/media/event', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, 'x-monitor-token': match[1] },
    body: JSON.stringify(event), signal: AbortSignal.timeout(3000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '事件被拒绝')
  return result
}
if (require.main === module) {
  const { values } = parseArgs({ options: { file: { type: 'string' }, port: { type: 'string', default: '18866' } } })
  Promise.resolve().then(async () => {
    if (!values.file || fs.statSync(values.file).size > 1024) throw new Error('请指定不超过 1 KB 的脱敏事件 JSON 文件：--file 路径')
    const result = await sendEvent(JSON.parse(fs.readFileSync(values.file, 'utf8')), Number(values.port))
    console.log(result.accepted ? '监控已收录上报；不代表真实通话通过。' : '监控忽略该事件：' + result.reason)
  }).catch(error => { console.error('未上报：' + error.message); process.exitCode = 1 })
}
module.exports = { sendEvent }
