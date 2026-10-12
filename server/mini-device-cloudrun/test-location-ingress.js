const { credentials } = require('./location-ingest-auth')
const { createRepository } = require('./repository')
const { fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const { createTestLocationStore, PATH } = require('./test-location-store')
const { createIngressServer } = require('./location-ingress')
function createTestIngressRuntime(config, dependencies = {}) {
  if (!config.testLocationEnabled) fail('CONFIG_REQUIRED', '此服务仅用于显式开启的硬件定位测试')
  const keys = credentials(config.testLocationRelayKeys)
  if (!keys.size) fail('AUTH_NOT_CONFIGURED', '请为测试定位入口配置独立签名凭证')
  if (!dependencies.repo && config.storageDriver !== 'mysql') fail('STORAGE_NOT_CONFIGURED', '请配置私有测试数据库')
  const repo = dependencies.repo || createRepository(config)
  const store = createTestLocationStore({ repo, config, now: dependencies.now })
  return { keys, ingest: store.ingest, sweep: store.sweep, close: () => repo.close() }
}
function createTestIngressServer({ config, runtime = createTestIngressRuntime(config), ...options }) {
  return createIngressServer({ ...options, config, runtime, path: PATH, serviceName: 'ailab-test-location-ingress' })
}
module.exports = { createTestIngressRuntime, createTestIngressServer }
