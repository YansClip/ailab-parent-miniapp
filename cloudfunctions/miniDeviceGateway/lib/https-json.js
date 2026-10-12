const https = require('node:https')
const { fail } = require('./contracts')

// Server-only transport: fixed configured origins, no redirects or automatic POST retries.
function httpsJson({ baseUrl, path, method = 'POST', token, data, timeoutMs = 8000 }) {
  let url
  try {
    const base = new URL(baseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error()
    if (typeof path !== 'string' || !path.startsWith('/v1/')) throw Error()
    url = new URL(path, base)
    if (url.origin !== base.origin) throw Error()
  } catch (_) { fail('PROVIDER_NOT_CONFIGURED', '请配置经过确认的 HTTPS 业务服务地址（不含接口路径）') }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('CONFIG_REQUIRED', '接口超时配置无效')
  const body = data === undefined ? null : JSON.stringify(data)
  return new Promise((resolve, reject) => {
    const error = (code, message) => Object.assign(new Error(message), { code })
    const req = https.request(url, { method, headers: {
      accept: 'application/json', authorization: 'Bearer ' + token,
      ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    } }, res => {
      let size = 0, chunks = []
      res.on('data', chunk => {
        size += chunk.length
        if (size > 262144) { req.destroy(error('PROVIDER_RESPONSE_INVALID', '业务服务响应过大')); return }
        chunks.push(chunk)
      })
      res.on('error', () => reject(error('PROVIDER_UNAVAILABLE', '业务服务连接中断，请稍后查询结果')))
      res.on('end', () => {
        if (res.statusCode === 401) return reject(error('PROVIDER_SESSION_EXPIRED', '探鸽测试账号凭证已过期，请由管理员更新'))
        if (res.statusCode !== 200) return reject(error('PROVIDER_UNAVAILABLE', '业务服务未成功响应，请查询原操作结果'))
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (_) { reject(error('PROVIDER_RESPONSE_INVALID', '业务服务返回格式异常')) }
      })
    })
    const timer = setTimeout(() => req.destroy(error('PROVIDER_TIMEOUT', '业务服务响应超时，请查询结果，不要重复提交')), timeoutMs)
    req.on('close', () => clearTimeout(timer))
    req.on('error', e => reject(e.code && e.code.startsWith('PROVIDER_') ? e : error('PROVIDER_UNAVAILABLE', '无法连接业务服务，请检查配置或网络')))
    if (body !== null) req.write(body)
    req.end()
  })
}
module.exports = { httpsJson }
