// Pure request/response helpers based on the archived official cloud-proxy docs.
// This module DOES NOT load the plugin, request authorization or call a device.
function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) }
function buildCloudCallRequest({ sn, modelId, mediaType }) {
  if (!identifier(sn) || !identifier(modelId) || !['voice', 'video'].includes(mediaType)) {
    throw Object.assign(new Error('官方通话设备参数无效'), { code: 'INVALID_ARGUMENT' })
  }
  // Incoming reminder permission is NOT a prerequisite for phone-originated calls.
  return { sn, modelId, roomType: mediaType, isCloud: true }
}
function incomingReminderState(list, target) {
  if (!target || !identifier(target.sn) || !identifier(target.modelId) || !Array.isArray(list)) return 'unknown'
  // Official getDeviceVoIPList uses model_id, not modelId. A client result is
  // only for local guidance; it must never grant backend business permissions.
  const rows = list.filter(x => x && x.sn === target.sn && x.model_id === target.modelId)
  if (!rows.length) return 'missing'
  if (rows.length !== 1) return 'unknown'
  return rows[0].status === 1 ? 'authorized' : rows[0].status === 0 ? 'unauthorized' : 'unknown'
}
module.exports = { buildCloudCallRequest, incomingReminderState }
