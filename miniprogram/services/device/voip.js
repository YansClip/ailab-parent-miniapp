// Official hardware plugin only. No camera/microphone APIs are used in demo mode.
function createVoip({ settings, getPlugin, navigate, getWindowInfo }) {
  let plugin, off
  function ensure() {
    if (!settings.enabled) throw { code: 'MEDIA_NOT_CONFIGURED', message: '微信硬件通话尚未开通，请先完成插件授权与型号配置' }
    if (!plugin) {
      try { plugin = getPlugin(settings.pluginAlias).default }
      catch (_) { throw { code: 'PLUGIN_UNAVAILABLE', message: '微信通话组件不可用，请检查插件授权和基础库版本' } }
    }
    if (!plugin || !['callDevice', 'onVoipEvent', 'forceHangUpVoip'].every(k => typeof plugin[k] === 'function') || typeof plugin.CALL_PAGE_PATH !== 'string' || !plugin.CALL_PAGE_PATH) throw { code: 'PLUGIN_UNAVAILABLE', message: '微信通话组件版本不支持完整的呼叫和结束操作' }
    return plugin
  }
  return {
    ensure,
    listen(handler) { const p = ensure(); if (off) off(); off = p.onVoipEvent(handler); return () => { if (off) off(); off = null } },
    async create(call) {
      const p = ensure(), cfg = call.plugin
      if (!cfg || !['linux-direct', 'cloud-device'].includes(cfg.route)) throw { code: 'UNSUPPORTED_ROUTE', message: '此设备的通话方案尚未适配' }
      const options = {
        roomType: call.mediaType, sn: cfg.sn, modelId: cfg.modelId, deviceName: cfg.deviceName,
        isCloud: cfg.route === 'cloud-device',
        // Correlation only; server callback must be verified, never trusted by payload alone.
        payload: cfg.route === 'cloud-device' ? JSON.stringify({ callId: call.id, deviceId: call.deviceId,
          bindingVersion: call.bindingVersion, mediaType: call.mediaType, expiresAt: call.expiresAt, hardExpiresAt: call.hardExpiresAt }) : undefined,
        enableCallerCamera: call.mediaType === 'video' && cfg.enableCallerCamera !== false,
        enableListenerCamera: call.mediaType === 'video' && cfg.enableListenerCamera !== false
      }
      const profile = cfg.videoProfile || {}
      if (call.mediaType === 'video') {
        if ([1, 2].includes(profile.encodeVideoRotation)) options.encodeVideoRotation = profile.encodeVideoRotation
        if (typeof p.setUIConfig === 'function') {
          const callerUI = { cameraRotation: 0 }, listenerUI = {}
          const info = getWindowInfo && getWindowInfo()
          if (info && info.screenWidth > 0 && info.screenHeight > 0) callerUI.aspectRatio = listenerUI.aspectRatio = info.screenHeight / info.screenWidth
          if ([0, 90, 180, 270].includes(profile.cameraRotation)) listenerUI.cameraRotation = profile.cameraRotation
          for (const k of ['horMirror', 'vertMirror']) if (typeof profile[k] === 'boolean') listenerUI[k] = profile[k]
          if (['contain', 'fill'].includes(profile.objectFit)) listenerUI.objectFit = profile.objectFit
          p.setUIConfig({ callerUI, listenerUI })
        }
      }
      if (Number.isFinite(cfg.timeLimit) && cfg.timeLimit > 0) options.timeLimit = cfg.timeLimit
      const result = await p.callDevice(options)
      if (!result || !result.roomId) throw { code: 'MEDIA_ROOM_MISSING', message: '未取得通话房间，请查询或结束本次呼叫' }
      return result.roomId
    },
    show() { return navigate(ensure().CALL_PAGE_PATH) },
    stop(roomId) { if (plugin && roomId) return plugin.forceHangUpVoip(roomId) },
    dispose() { if (off) off(); off = null }
  }
}
module.exports = { createVoip }
