// Read-only local preparation check. Never probes the public template service.
const fs = require('node:fs')
const path = require('node:path')
const c = require('../miniprogram/config/device')
const { connection } = require('../miniprogram/services/device/transport')
let configured = false
try { connection(c); configured = true } catch (_) {}
const project = require('../project.config.json')
const checks = [
  ['AppID 与本地项目一致', c.appId === project.appid],
  ['已选择云托管 SDK 接入', c.transport === 'cloudrun'],
  ['已记录云托管环境（不是云函数环境）', !!(c.cloudrun && c.cloudrun.envId)],
  ['设备业务服务已配置启用', configured],
  ['保持演示流程，不自动启用真实设备/通话', c.mode === 'demo' && c.voip.enabled === false],
  ['Docker 构建文件与依赖锁存在', ['Dockerfile', 'package-lock.json', 'schema.sql', '.env.example'].every(f => fs.existsSync(path.resolve(__dirname, '../server/mini-device-cloudrun', f)))]
]
checks.forEach(([name, ok]) => console.log((ok ? 'OK   ' : '待办 ') + name))
console.log('服务部署、网关隔离、可信身份、MySQL、硬件定位和媒体均未由此脚本验证。')
if (process.argv.includes('--strict') && checks.some(([, ok]) => !ok)) process.exitCode = 1
