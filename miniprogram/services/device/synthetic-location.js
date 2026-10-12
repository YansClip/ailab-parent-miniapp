// Isolated read-only loopback transport. No store, real identity, cloud or fallback.
function createSyntheticClient({ wxApi, clock = Date.now }) {
  const base = 'http://127.0.0.1:18868/api/'
  let token = '', expiresAt = 0, generation = 0
  const tasks = new Set()
  const error = (code, message) => ({ code, message })
  function ensure() {
    const account = wxApi.getAccountInfoSync && wxApi.getAccountInfoSync().miniProgram
    const device = wxApi.getDeviceInfo ? wxApi.getDeviceInfo() : wxApi.getSystemInfoSync && wxApi.getSystemInfoSync()
    if (!account || account.appId !== 'wxc5abf3407ed4ef30' || account.envVersion !== 'develop' || !device || device.platform !== 'devtools') throw error('DEVTOOLS_ONLY', '仅限本台电脑的微信开发者工具；手机、体验版和正式版不能连接本机模拟工具。')
  }
  function clear() {
    generation++; token = ''; expiresAt = 0
    for (const entry of tasks) { entry.cancel(); if (entry.task && entry.task.abort) entry.task.abort() }
    tasks.clear()
  }
  function request(action, data) {
    try { ensure() } catch (e) { return Promise.reject(e) }
    if (action !== 'pair' && (!token || expiresAt <= clock())) { clear(); return Promise.reject(error('UNPAIRED', '本机会话已失效，请重新生成配对码。')) }
    const version = generation
    return new Promise((resolve, reject) => {
      let finished = false, timer
      const entry = { task: null, cancel: () => finish(reject, error('CANCELLED', '页面已离开，旧请求已取消')) }
      function finish(fn, value) { if (finished) return; finished = true; clearTimeout(timer); tasks.delete(entry); fn(value) }
      tasks.add(entry)
      // Some devtools networking failures do not deliver either callback.
      timer = setTimeout(() => {
        finish(reject, error('LOCAL_UNREACHABLE', '本机连接超时，请确认模拟定位台已启动后重试。'))
        if (entry.task && entry.task.abort) entry.task.abort()
      }, 5000)
      try {
        entry.task = wxApi.request({ url: base + action, method: action === 'state' ? 'GET' : 'POST', timeout: 5000,
          header: { 'content-type': 'application/json', 'x-sim-token': token }, ...(data ? { data } : {}),
          success(res) {
            if (finished) return
            if (version !== generation) return entry.cancel()
            const body = res.data
            if (res.statusCode !== 200 || !body || body.ok !== true) {
              const failure = body && body.error || error('LOCAL_ERROR', '本机服务返回异常；不会显示示例点代替。')
              finish(reject, failure)
              if (failure.code === 'UNPAIRED') clear()
              return
            }
            finish(resolve, body.data)
          },
          fail() { finish(reject, error(version !== generation ? 'CANCELLED' : 'LOCAL_UNREACHABLE', '无法连接本机模拟定位台。请确认工具已启动，以及开发者工具允许本地网络调试；不会尝试连接云端。')) }
        })
      } catch (e) { finish(reject, error('LOCAL_UNREACHABLE', '本机请求未能发出，请检查开发者工具。')) }
    })
  }
  return {
    availability() { try { ensure(); return '' } catch (e) { return e.message } },
    clear,
    paired: () => !!token && expiresAt > clock(),
    async pair(value) {
      clear()
      const version = generation, code = String(value || '').trim().toUpperCase()
      if (!/^[A-F0-9]{10}$/.test(code)) throw error('PAIR_INVALID', '请输入控制台显示的 10 位配对码。')
      const response = await request('pair', { code })
      if (version !== generation) throw error('CANCELLED', '配对已取消')
      if (!response || response.contract !== 'ailab-synthetic-location/v1' || !/^[a-f0-9]{64}$/.test(response.token) || !Number.isFinite(response.expiresAt) || response.expiresAt <= clock() || response.expiresAt > clock() + 1800000) throw error('LOCAL_ERROR', '配对响应无效')
      token = response.token; expiresAt = response.expiresAt
    },
    state: () => request('state')
  }
}
module.exports = { createSyntheticClient }
