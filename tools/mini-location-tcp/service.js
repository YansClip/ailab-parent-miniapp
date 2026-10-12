'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const label = 'com.ailab.mini-device-monitor'
const plist = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist')
function installed() { return process.platform === 'darwin' && fs.existsSync(plist) }
function control(action) {
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('用法：service.js start|stop|status')
  if (!installed()) throw new Error('没有安装本机后台常驻配置')
  // Do not control an unrelated service whose configuration has been replaced.
  if (!fs.readFileSync(plist, 'utf8').includes(path.join(__dirname, 'cli.js'))) throw new Error('常驻配置不是当前项目，请核对路径')
  const domain = 'gui/' + process.getuid()
  const target = domain + '/' + label
  const run = args => execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  let loaded = false
  try { run(['print', target]); loaded = true } catch (_) {}
  if (action === 'start') {
    run(['enable', target])
    if (!loaded) run(['bootstrap', domain, plist])
    console.log('后台常驻已开启，异常退出后会自动重启。监控地址：http://127.0.0.1:18866')
  } else if (action === 'stop') {
    run(['disable', target])
    if (loaded) run(['bootout', target])
    console.log('后台常驻已停用，不会自动重启；下次双击启动脚本可恢复。')
  } else console.log(loaded ? '后台常驻已加载；请在网页确认实时健康状态。' : '后台常驻未加载。')
}
if (require.main === module) {
  try { control(process.argv[2]) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { installed, control }
