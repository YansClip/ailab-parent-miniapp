const fs = require('node:fs')
const path = require('node:path')
const { connection } = require('../miniprogram/services/device/transport')
const { readConfig } = require('../server/mini-device-cloudrun/config')
function inspect({ config, project, app }) {
  const plugin = app.plugins && app.plugins[config.voip.pluginAlias]
  let backendReady = false
  try { connection(config); backendReady = true } catch (_) {}
  // Inspect checked-in policy, never cloud secrets or process.env.
  const runtime = readConfig({})
  const checks = [
    ['appid', '项目 AppID 一致', project.appid === config.appId],
    ['transport', '本地云服务调用参数已配置（不代表云端通话就绪）', backendReady],
    ['mode', '真实设备模式已启用', config.mode === 'cloud'],
    ['switch', '通话开关已启用', config.voip.enabled === true],
    ['plugin', '微信官方插件已声明', !!plugin && plugin.provider === 'wxf830863afde621eb' && typeof plugin.version === 'string'],
    ['version', '插件版本已固定（非空且非 latest）', !!plugin && typeof plugin.version === 'string' && plugin.version.trim().length > 0 && plugin.version !== 'latest']
  ].map(([id, label, ready]) => ({ id, label, status: ready ? 'ready' : 'todo' }))
  if (config.transport === 'cloudrun') checks.push({ id: 'media-relay', status: runtime.mediaStateRelayReady ? 'unverified' : 'blocked',
    label: '当前云托管代码未开放可信通话回执接入；仅改环境变量不能启用真实呼叫' })
  checks.push(...[
    ['platform', '本 AppID 的硬件 VoIP 许可、ModelID 和插件授权'],
    ['official-sdk', '微信官方 RTOS / 云对云 SDK、可信回调、设备上线和媒体连接'],
    ['hardware', '鱼鹰 P4+C5 固件、双向声音和双向画面真机验证'],
    ['hangup', '接听后挂断接口及媒体停止回执（cancel 不能直接等同挂断）']
  ].map(([id, label]) => ({ id, label, status: 'unverified' })))
  return { localOnly: true, realCallReady: false, mediaVerified: false, checks }
}
function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..')
  const report = inspect({ config: require('../miniprogram/config/device'),
    project: JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')),
    app: JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8')) })
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
  else {
    const labels = { ready: 'OK   ', todo: '待办 ', blocked: '阻断 ', unverified: '待核 ' }
    report.checks.forEach(c => console.log(labels[c.status] + c.label))
    console.log('只检查本地代码；不读取凭证、不调用云服务、不启用插件、不上传或修改配置。')
  }
  if (args.includes('--strict') && report.checks.some(c => c.status !== 'ready')) process.exitCode = 1
  return report
}
if (require.main === module) main()
module.exports = { inspect, main }
