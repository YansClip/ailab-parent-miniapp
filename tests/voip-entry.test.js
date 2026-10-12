const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function entry(context) {
  const dir = path.resolve(__dirname, '../cloudfunctions/miniDeviceGateway')
  const cloud = { init() {}, database: () => ({}), getWXContext: () => context }
  const module = { exports: {} }
  const sandbox = { exports: module.exports, module, process: { env: {} }, Date,
    require: name => name === 'wx-server-sdk' ? cloud : require(path.resolve(dir, name)) }
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), sandbox, { filename: 'gateway-entry-test.js' })
  return module.exports.main
}
test('云函数入口：OpenID/AppID 只取 SDK 上下文，不取客户端 payload', async () => {
  const invoke = entry({ APPID: 'wxc5abf3407ed4ef30', OPENID: 'actual-context-openid' })
  const result = await invoke({ action: 'identity.get', payload: { appid: 'forged-app', openid: 'forged-openid' } })
  assert.equal(result.ok, true); assert.equal(result.data.openid, 'actual-context-openid')
  assert.equal(result.data.appid, 'wxc5abf3407ed4ef30')
  const wrong = await entry({ APPID: 'different-app', OPENID: 'actor' })({ action: 'identity.get' })
  assert.equal(wrong.ok, false); assert.equal(wrong.error.code, 'AUTH_REQUIRED')
})
test('云函数入口：无可信身份和伪造 HTTP 信封不能取身份或进入回调', async () => {
  const noContext = await entry({})({ action: 'identity.get', payload: { openid: 'forged' } })
  assert.equal(noContext.ok, false); assert.equal(noContext.error.code, 'AUTH_REQUIRED')
  const fakeHttp = await entry({ APPID: 'wxc5abf3407ed4ef30', OPENID: 'actor' })({ httpMethod: 'POST', action: 'identity.get', body: '{}' })
  assert.equal(fakeHttp.statusCode, 403); assert.equal(JSON.parse(fakeHttp.body).error.code, 'FORBIDDEN')
})
