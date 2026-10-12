const { fail } = require('../../cloudfunctions/miniDeviceGateway/lib/contracts')
function readConfig(env = process.env) {
  const config = {
    appid: env.MINI_APP_ID || 'wxc5abf3407ed4ef30',
    cloudrunEnv: env.WX_CLOUDRUN_ENV || '',
    gatewayOnlyConfirmed: env.WX_GATEWAY_ONLY_CONFIRMED === 'true',
    storageDriver: env.STORAGE_DRIVER || 'disabled',
    serviceRole: env.SERVICE_ROLE || 'business',
    locationProvider: env.LOCATION_PROVIDER || 'disabled',
    locationRelayKeys: env.LOCATION_RELAY_KEYS_JSON || '',
    port: Number(env.PORT || 8080), host: env.HOST || '127.0.0.1',
    voipProvider: env.VOIP_PROVIDER || 'disabled',
    thingconnectUserUrl: env.THINGCONNECT_USER_URL, thingconnectVoipUrl: env.THINGCONNECT_VOIP_URL,
    providerTimeoutMs: Number(env.PROVIDER_TIMEOUT_MS || 8000),
    // No device/public callback is mounted in this phase. Never enable real calls here.
    mediaStateRelayReady: false, callbackProtocol: 'disabled',
    mysql: {
      host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306),
      user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE,
      tls: env.MYSQL_TLS !== 'false', ca: env.MYSQL_CA_PEM,
      privateNetworkConfirmed: env.MYSQL_PRIVATE_NETWORK_CONFIRMED === 'true'
    }
  }
  for (const [name, variable] of Object.entries({ locationTtlMs: 'LOCATION_TTL_MS', statusTtlMs: 'STATUS_TTL_MS', watchLeaseMs: 'WATCH_LEASE_MS', pollMs: 'LOCATION_POLL_MS', refreshTimeoutMs: 'LOCATION_REFRESH_TIMEOUT_MS', callInviteTimeoutMs: 'CALL_INVITE_TIMEOUT_MS', maxCallMs: 'MAX_CALL_MS' })) config[name] = Number(env[variable])
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) fail('CONFIG_REQUIRED', '服务监听端口配置无效')
  if (!['disabled', 'mysql'].includes(config.storageDriver)) fail('CONFIG_REQUIRED', '请选择支持的私有持久化存储')
  if (!['business', 'location-ingress'].includes(config.serviceRole) || !['disabled', 'push'].includes(config.locationProvider)) fail('CONFIG_REQUIRED', '设备后台职责或定位接入配置无效')
  return config
}
module.exports = { readConfig }
