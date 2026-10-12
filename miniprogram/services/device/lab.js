// Development-only HTTP transport. Never used as a cloud failure fallback.
function createLabClient({ wxApi, store, clock = Date.now }) {
  const base = 'http://127.0.0.1:18866/lab/v1/'
  let access = '', generation = 0, enabled = false, sessionId = '', expiresAt = 0, pending = null, currentCall = null, starting = null, callRequest = null, callVersion = 0
  const tasks = new Set()
  const error = (code, message) => ({ code, message })
  function ensure(cleanup = false) {
    const account = wxApi.getAccountInfoSync && wxApi.getAccountInfoSync().miniProgram
    const device = wxApi.getDeviceInfo ? wxApi.getDeviceInfo() : wxApi.getSystemInfoSync && wxApi.getSystemInfoSync()
    if (!account || account.appId !== 'wxc5abf3407ed4ef30' || account.envVersion !== 'develop' || !device || device.platform !== 'devtools') throw error('LAB_DEVTOOLS_ONLY', '本机联调仅限本项目微信开发者工具；体验版、正式版和手机真机不能启用')
    if (!cleanup && !store.getSession().privacyAccepted) throw error('PRIVACY_REQUIRED', '请先确认隐私规则')
  }
  function request(action, data = {}, options = {}) {
    try { ensure(options.cleanup) } catch (e) { return Promise.reject(e) }
    if (action !== 'pair' && !access) return Promise.reject(error('LAB_UNPAIRED', '请在体验设置输入联调台的一次性配对码'))
    const version = generation, epoch = store.getEpoch(), credential = access
    return new Promise((resolve, reject) => {
      let task
      const done = () => { if (task) tasks.delete(task) }
      task = wxApi.request({ url: base + action, method: 'POST', timeout: 5000,
        header: { 'content-type': 'application/json', 'x-lab-token': credential }, data,
        success(res) {
          done()
          if (!options.cleanup && (version !== generation || epoch !== store.getEpoch())) return reject(error('CANCELLED', '联调环境已改变，旧响应已忽略'))
          const body = res.data
          if (res.statusCode !== 200 || !body || body.ok !== true) {
            const failure = body && body.error || error('LAB_RESPONSE_ERROR', '本机联调服务拒绝请求')
            if (failure.code === 'LAB_UNPAIRED' && version === generation) clear()
            return reject(failure)
          }
          resolve(body.data)
        },
        fail() {
          done()
          reject(!options.cleanup && version !== generation ? error('CANCELLED', '联调请求已取消') : error('LAB_UNREACHABLE', '无法连接本机联调台，请检查后台服务及开发者工具的本地网络调试设置；不会回退演示数据'))
        }
      })
      if (!options.cleanup) tasks.add(task)
    })
  }
  function clear() {
    generation++; callVersion++; access = ''; sessionId = ''; expiresAt = 0; pending = null; currentCall = null; callRequest = null; starting = null
    for (const task of tasks) if (task && task.abort) task.abort()
    tasks.clear()
  }
  function invalidate() {
    // Keep lab selected but unpaired after logout/revoke. Never fall back to demo.
    if (access) request('disconnect', {}, { cleanup: true }).catch(() => {})
    clear()
  }
  function present(c) {
    currentCall = c
    if (!c) return null
    const stages = { REJECTED: 'rejected', BUSY: 'busy', NO_ANSWER: 'timeout', FAILED: 'failed', INTERRUPTED: 'interrupted', DEVICE_OFFLINE: 'interrupted' }
    return { ...c, stage: c.state === 'ended' ? stages[c.endReason] || 'ended' : c.state, isDemo: true, isLab: true }
  }
  async function snapshot() {
    const value = await request('snapshot'), point = value.status === 'lab-point' ? value.point : null
    const descriptions = { unselected: '尚未选择测试连接', offline: '测试连接已断开', waiting: '等待设备上报', unframed: '报文边界未确认', stale: '上报已过展示时限', 'coordinate-unknown': '坐标系未确认', 'lab-point': '本机联调点位' }
    return { child: { id: 'lab', name: '测试连接', shortName: value.connectionId || '未选择' }, deviceId: value.connectionId || 'lab',
      point, status: point ? 'valid' : value.status, label: descriptions[value.status] || '暂无联调点位',
      isLab: true, isDemo: false, online: value.connected, battery: null, accuracy: null,
      updatedAt: value.receivedAt, measuredAt: null, receivedAt: clock(), remainingMs: value.remainingMs,
      expiresAt: clock() + value.remainingMs, hint: '这不是正式守护位置：设备身份、实际采集时间及精度未提供。离线或过期后清除，不保存轨迹。',
      capabilities: { voice: false, video: false }, productionReady: false }
  }
  return { request, snapshot, invalidate, isEnabled: () => enabled,
    availability() { try { ensure(); return '' } catch (e) { return e.message } },
    info: () => ({ enabled, paired: Boolean(access) && expiresAt > clock(), expiresAt, sessionId }),
    async pair(code) {
      ensure(); invalidate(); enabled = true
      const version = generation
      const data = await request('pair', { code: String(code || '').trim().toUpperCase() })
      if (version !== generation) throw error('CANCELLED', '配对已取消')
      access = data.token; expiresAt = data.expiresAt; sessionId = data.sessionId
      return { paired: true, expiresAt }
    },
    async disable() { if (access) await request('disconnect').catch(() => {}); clear(); enabled = false },
    async loadTargets() { const loc = await snapshot(); return [{ id: loc.deviceId, name: '本机测试连接', shortName: loc.child.shortName, deviceName: '未认证测试来源', avatarColor: '#227BB8' }] },
    select() { return Promise.reject(error('LAB_FIXED_SOURCE', '请在联调台选择新的 TCP 连接并重新配对；不会自动换设备')) },
    watch(stop) { return request(stop ? 'unwatch' : 'watch') },
    async refresh() {
      if (!pending) pending = 'r-' + clock() + '-' + Math.random().toString(36).slice(2, 9)
      const result = await request('refresh', { requestId: pending })
      if (['success', 'timeout'].includes(result.state)) pending = null
      return result
    },
    async status() { await request('snapshot'); return { child: { shortName: '本机模拟' }, online: null, capabilities: { voice: true, video: true }, isLab: true } },
    async getCall() {
      const version = callVersion, result = await request('call.get')
      if (version !== callVersion) throw error('CANCELLED', '通话操作已改变，旧查询已忽略')
      return present(result)
    },
    start(type) {
      if (starting) return starting
      if (!callRequest) callRequest = 'c-' + clock() + '-' + Math.random().toString(36).slice(2, 9)
      const version = ++callVersion
      const promise = request('call.start', { mediaType: type, requestId: callRequest }).then(c => {
        if (version !== callVersion) throw error('CANCELLED', '呼叫准备已取消，迟到响应已忽略')
        callRequest = null; return present(c)
      }).finally(() => { if (starting === promise) starting = null })
      starting = promise
      return promise
    },
    async cleanup() {
      ++callVersion; starting = null
      const result = await request('call.end', { callId: callRequest ? null : currentCall && currentCall.id, requestId: callRequest })
      callRequest = null
      return present(result)
    },
    showCall() { return Promise.reject(error('LAB_NO_MEDIA', '本机模式只联调状态，不启动真实音视频组件')) }
  }
}
module.exports = { createLabClient }
