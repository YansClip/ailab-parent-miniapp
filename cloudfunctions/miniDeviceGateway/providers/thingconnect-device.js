const { fail, scopeOf, sameScope } = require('../lib/contracts')
const { createThingConnect } = require('./thingconnect')

// Uses the supplier's managed voip-server for native WeChat callbacks, TiRTC
// tokens and MQTT invitations. It does NOT implement a media/transcoding server.
function createThingConnectDevice({ repo, config, provider = createThingConnect({ repo, config }), now = Date.now }) {
  async function owner(s) {
    const b = await repo.get('mini_bindings', s.deviceId)
    if (!b || !b.active || !sameScope(b, s)) fail('BINDING_CHANGED', '测试设备绑定已改变')
    if (!b.media || !b.media.accountOpenid) fail('PROVIDER_ACCOUNT_REQUIRED', '管理员尚未指定此测试设备的探鸽账号归属')
    return { b, user: { openid: b.media.accountOpenid, appid: config.appid } }
  }
  async function info(s) {
    const { b, user } = await owner(s), rows = await provider.devices(user)
    const d = rows.find(x => x.device_id === b.deviceId && x.status === 1)
    if (!d) fail('PROVIDER_DEVICE_FORBIDDEN', '测试设备未绑定到指定探鸽账号，请先在平台完成绑定')
    const p = d.profiles && d.profiles.voip || {}
    const camera = p.has_camera === true && ['h264', 'h265', 'mjpeg'].includes(p.up_video_mt)
    const screen = p.has_screen === true && ['h264', 'mjpeg'].includes(p.down_video_mt)
    return { b, d, p, camera, screen }
  }
  return {
    async getDevice(s) {
      const { b, d, camera, screen } = await info(s)
      const voice = b.media.audioVerified === true
      return { ...scopeOf(b), online: d.online === true, stateTime: now(), stateSource: 'thingconnect-query', battery: null,
        callBusy: false, // Remote busy responses remain authoritative; no invented media occupancy endpoint.
        capabilities: { location: false, voice, video: voice && b.media.videoVerified === true && camera && screen } }
    },
    async authorizeCall(user, b) {
      if (config.mediaStateRelayReady !== true || config.callbackProtocol !== 'ailab-hmac-v1' || !config.callbackSecret || config.callbackSecret.length < 32) fail('CALL_STATE_NOT_CONFIGURED', '设备接听、媒体连接与结束回执尚未对接；暂不启用正式呼叫')
      const rows = await provider.authList(user), a = rows.find(x => x.device_id === b.deviceId && x.auth_status === 'active')
      if (!a || !a.authorized_device_name) fail('VOIP_AUTH_REQUIRED', '探鸽后台尚未确认本人的设备通话授权')
      const { p, camera, screen } = await info(scopeOf(b))
      return { deviceName: a.authorized_device_name,
        enableCallerCamera: screen, enableListenerCamera: camera,
        videoProfile: { cameraRotation: [0, 90, 180, 270].includes(p.camera_rotation) ? p.camera_rotation : undefined,
          horMirror: typeof p.hor_mirror === 'boolean' ? p.hor_mirror : undefined,
          vertMirror: typeof p.vert_mirror === 'boolean' ? p.vert_mirror : undefined,
          objectFit: ['contain', 'fill'].includes(p.object_fit) ? p.object_fit : undefined,
          encodeVideoRotation: [1, 2].includes(p.down_video_rotation) ? p.down_video_rotation : undefined } }
    },
    // callDevice(isCloud=true) already causes WeChat -> managed voip-server -> MQTT.
    async inviteCall(c) {
      if (c.route !== 'cloud-device') fail('UNSUPPORTED_ROUTE', '探鸽接入仅支持已确认的云对云通话线路')
      return { managedInvitation: true }
    },
    async endCall(c) {
      // HTTP success confirms notification submission, never device/media termination.
      if (c.roomId) await provider.cancel({ openid: c.openid, appid: config.appid }, c.deviceId, c.roomId)
      return { confirmed: false }
    },
    async getCall() { return null }, // State arrives via verified normalized relay, not an invented endpoint.
    async getLocation() { return null },
    async startWatch() { fail('UNSUPPORTED', '探鸽通话接入不替代原定位协议') },
    async stopWatch() { return null },
    async refreshLocation() { fail('UNSUPPORTED', '尚未配置正式定位指令接口') },
    async getOperation() { return null }
  }
}
module.exports = { createThingConnectDevice }
