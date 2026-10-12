const test = require('node:test')
const assert = require('node:assert/strict')
const { runRehearsal, sampleEvent } = require('../tools/voip-rehearsal')
const { inspect } = require('../scripts/voip-preflight')
test('offline AV rehearsal exercises production state/relay contracts without claiming real media', async () => {
  const report = await runRehearsal()
  assert.equal(report.passed, 12)
  assert.equal(report.syntheticOnly, true)
  assert.equal(report.cloudTouched, false)
  assert.equal(report.realMediaVerified, false)
  assert.ok(report.results.every(r => r.passed))
  assert.equal(JSON.stringify(report).includes('callbackSecret'), false)
})
test('local configuration cannot pass AV readiness while cloudrun relay is blocked', () => {
  const config = { appId: 'test-app', mode: 'cloud', transport: 'cloudrun', cloudrun: { enabled: true, envId: 'test-env', serviceName: 'test-service', path: '/api/gateway' }, voip: { enabled: true, pluginAlias: 'wmpf-voip' } }
  const app = { plugins: { 'wmpf-voip': { provider: 'wxf830863afde621eb', version: '1.0.0' } } }
  const report = inspect({ config, project: { appid: config.appId }, app })
  assert.equal(report.checks.find(c => c.id === 'media-relay').status, 'blocked')
  assert.equal(report.realCallReady, false)
  app.plugins['wmpf-voip'].version = ''
  assert.equal(inspect({ config, project: { appid: config.appId }, app }).checks.find(c => c.id === 'version').status, 'todo')
})
test('engineer example is synthetic and contains no provider tokens', () => {
  const event = sampleEvent()
  assert.equal(event.deviceId, 'SYNTHETIC-DEVICE')
  assert.equal(event.kind, 'call')
  for (const field of ['token', 'wx_session_key', 'wx_server_token', 'openid']) assert.equal(event[field], undefined)
})
