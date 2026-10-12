const cloud = require('wx-server-sdk')
const { createService } = require('./lib/service')
const { cloudRepository } = require('./lib/repository')
const { handleCallback } = require('./lib/callback')
const createProvider = require('./providers/unconfigured')
const { createVoipAccess } = require('./lib/voip-access')
const { createThingConnectDevice } = require('./providers/thingconnect-device')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const config = {
  appid: process.env.MINI_APP_ID || 'wxc5abf3407ed4ef30',
  locationTtlMs: Number(process.env.LOCATION_TTL_MS), statusTtlMs: Number(process.env.STATUS_TTL_MS),
  watchLeaseMs: Number(process.env.WATCH_LEASE_MS), pollMs: Number(process.env.LOCATION_POLL_MS),
  refreshTimeoutMs: Number(process.env.LOCATION_REFRESH_TIMEOUT_MS), callInviteTimeoutMs: Number(process.env.CALL_INVITE_TIMEOUT_MS), maxCallMs: Number(process.env.MAX_CALL_MS),
  callbackProtocol: process.env.CALLBACK_PROTOCOL || 'disabled', callbackSecret: process.env.CALLBACK_SECRET,
  voipProvider: process.env.VOIP_PROVIDER || 'disabled',
  thingconnectUserUrl: process.env.THINGCONNECT_USER_URL, thingconnectVoipUrl: process.env.THINGCONNECT_VOIP_URL,
  providerTimeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS || 8000),
  mediaStateRelayReady: process.env.MEDIA_STATE_RELAY_READY === 'true'
}
const repo = cloudRepository(cloud.database())
const service = createService({ repo, provider: config.voipProvider === 'thingconnect' ? createThingConnectDevice({ repo, config }) : createProvider(), config })
const access = createVoipAccess({ repo, service, config })
exports.main = async (event = {}) => {
  const http = typeof event.httpMethod === 'string'
  try {
    const wxContext = cloud.getWXContext()
    // A client cannot submit a fabricated HTTP envelope to bypass user authorization.
    if (http && wxContext.OPENID) throw Object.assign(new Error('客户端不能调用设备回调入口'), { code: 'FORBIDDEN' })
    const data = http
      ? await handleCallback(event, { service, repo, config })
      : await (access.handles(event.action) ? access : service).dispatch(event.action, event.payload, { openid: wxContext.OPENID, appid: wxContext.APPID })
    const body = { ok: true, data, serverTime: Date.now() }
    return http ? { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : body
  } catch (err) {
    // Never log raw event, coordinates, credentials, room payload or upstream errors.
    const code = err.code || 'INTERNAL_ERROR'
    const body = { ok: false, error: { code, message: err.code ? err.message : '设备服务暂不可用，请稍后重试' } }
    return http ? { statusCode: code === 'INTERNAL_ERROR' ? 500 : 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : body
  }
}
