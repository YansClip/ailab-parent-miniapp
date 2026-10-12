const crypto = require('node:crypto')
const { fail, key, id } = require('./contracts')
// Optional AILab relay protocol. This is NOT WeChat's native encrypted callback.
// Default is disabled; a vendor/native adapter must be agreed before deployment.
function verifyRelay(event, config, now) {
  if (config.callbackProtocol !== 'ailab-hmac-v1' || !config.callbackSecret || config.callbackSecret.length < 32) fail('CALLBACK_NOT_CONFIGURED', '回调验签尚未配置')
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [k.toLowerCase(), v]))
  const ts = String(headers['x-ailab-timestamp'] || ''), nonce = headers['x-ailab-nonce'], signature = headers['x-ailab-signature']
  id(nonce, '回调编号')
  if (!/^\d{13}$/.test(ts) || Math.abs(now - Number(ts)) > 300000) fail('CALLBACK_EXPIRED', '回调已过期')
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 32768) fail('INVALID_CALLBACK', '回调体无效')
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) fail('INVALID_SIGNATURE', '回调签名无效')
  const expected = crypto.createHmac('sha256', config.callbackSecret).update(ts + '\n' + nonce + '\n' + raw).digest()
  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), expected)) fail('INVALID_SIGNATURE', '回调签名无效')
  let payload
  try { payload = JSON.parse(raw) } catch (_) { fail('INVALID_CALLBACK', '回调不是有效 JSON') }
  return { payload, receiptId: key(nonce, ts), digest: key(raw), expiresAt: now + 600000 }
}
async function handleCallback(event, { service, repo, config, now = Date.now }) {
  if (event.httpMethod !== 'POST') fail('METHOD_NOT_ALLOWED', '仅允许 POST 回调')
  const verified = verifyRelay(event, config, now())
  const duplicate = await repo.transaction(async tx => {
    const old = await tx.get('mini_event_receipts', verified.receiptId)
    if (old && old.digest !== verified.digest) fail('REPLAY_CONFLICT', '回调编号已使用')
    if (old && old.complete) return true
    if (!old) await tx.put('mini_event_receipts', verified.receiptId, { id:verified.receiptId, digest:verified.digest, complete:false, expiresAt:verified.expiresAt })
    return false
  })
  if (duplicate) return { accepted: true, duplicate: true }
  // Domain handlers are idempotent as concurrent duplicate callbacks may reach here.
  const result = await service.deviceEvent(verified.payload)
  await repo.put('mini_event_receipts', verified.receiptId, { id: verified.receiptId, digest: verified.digest, complete: true, expiresAt: verified.expiresAt })
  return result
}
module.exports = { verifyRelay, handleCallback }
