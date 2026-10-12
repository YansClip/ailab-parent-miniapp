const { createService } = require('../../cloudfunctions/miniDeviceGateway/lib/service')
const { createVoipAccess } = require('../../cloudfunctions/miniDeviceGateway/lib/voip-access')
const createUnconfigured = require('../../cloudfunctions/miniDeviceGateway/providers/unconfigured')
const { createThingConnectDevice } = require('../../cloudfunctions/miniDeviceGateway/providers/thingconnect-device')
const { createRepository } = require('./repository')
const { fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
const { createLocationStore, createLocationProvider } = require('./location-store')
const ACTIONS = new Set(['identity.get', 'system.health', 'context.list', 'device.snapshot', 'device.status', 'location.watch', 'location.unwatch', 'location.refresh', 'operation.get', 'call.prepare', 'call.attach', 'call.get', 'call.current', 'call.end', 'call.event', 'voip.readiness', 'voip.login', 'voip.targets', 'voip.ticket', 'voip.report', 'voip.status', 'voip.revoke'])
function createRuntime(config, dependencies = {}) {
  const repo = dependencies.repo || createRepository(config)
  const locationStore = config.locationProvider === 'push' ? createLocationStore({ repo, config, now: dependencies.now }) : null
  const fallback = config.voipProvider === 'thingconnect' ? createThingConnectDevice({ repo, config }) : createUnconfigured()
  const provider = dependencies.provider || (locationStore ? createLocationProvider({ store: locationStore, config, now: dependencies.now, fallback }) : fallback)
  const service = createService({ repo, provider, config, now: dependencies.now })
  const access = createVoipAccess({ repo, service, config, now: dependencies.now })
  return {
    async dispatch(action, payload, user) {
      if (!user || user.appid !== config.appid || !user.openid || user.source !== 'wx-cloudrun-gateway') fail('AUTH_REQUIRED', '请求身份未经微信网关核验')
      if (!ACTIONS.has(action)) fail('INVALID_ACTION', '不支持的设备操作')
      if (action === 'system.health') return {
        contract: 'ailab-mini-device/v1', appid: config.appid, source: user.source, isDemo: false,
        storageReady: await repo.health(), mediaVerified: false, deviceIntegrationVerified: false, locationProvider: config.locationProvider || 'disabled'
      }
      return (access.handles(action) ? access : service).dispatch(action, payload, user)
    }, sweep: () => locationStore ? locationStore.sweep() : Promise.resolve(), close: () => repo.close()
  }
}
module.exports = { createRuntime }
