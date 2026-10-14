const api = require('../../services/api')
const util = require('../../utils/util')
const store = require('../../services/store')
const access = require('../../services/access')
Page({
  data: { current: 'default', childName: '', courseId: 'B04', busy: false, activeRealAction: '', cloudConnectionError: '', cloudLocation: null, lastResult: '', pairCode: '', lab: {}, labResult: '', cloudBindings: null, realIdentity: null, realChecks: null, realTargets: [], realSelectedId: '', realResult: '', realStatus: null, remark: '', list: [
    {id:'default',name:'正常：设备在线、数据完整'},
    {id:'empty',name:'数据不足：未知而非零分'}, {id:'loading',name:'请求响应较慢'},
    {id:'device-offline',name:'设备离线：配置等待同步'}, {id:'stale',name:'位置过期：清除地图坐标'},
    {id:'offline',name:'请求失败：明确重试入口'}, {id:'call-busy',name:'设备忙 / 通话占线'},
    {id:'call-rejected',name:'通话被拒绝'}, {id:'call-permission',name:'音视频权限被拒绝'}, {id:'call-interrupted',name:'接通后通话中断'}, {id:'timeout',name:'超时：查询最终结果'},
    {id:'fail',name:'设备执行失败'}, {id:'device-online',name:'设备恢复在线并同步配置'}, {id:'generating',name:'报告生成中'}
  ]},
  onShow() {
    util.beginRequest(this, 'real-setup')
    this.setData({ busy: false, activeRealAction: '' })
    this.reload()
  },
  clearCloudLocation() {
    clearTimeout(this.cloudLocationExpiry)
    this.cloudLocationExpiry = null
    this.setData({ cloudLocation: null })
  },
  async checkCloudTestLocation() {
    if (this.data.busy) return
    this.clearCloudLocation()
    await this.realAction(async () => ({ cloudLocation: await api.checkCloudTestLocation() }), 'location')
    const value = this.data.cloudLocation
    if (value && value.hasPoint) {
      this.cloudLocationExpiry = setTimeout(() => {
        this.cloudLocationExpiry = null
        util.safeSetData(this, { cloudLocation: { ...value, status: 'stale', label: '测试位置已过期', hint: '请再次检查，等待硬件上报新的位置。', hasPoint: false, longitude: '—', latitude: '—', remainingMs: 0 } })
      }, value.remainingMs)
    }
  },
  openLocationTest() { wx.navigateTo({ url: '/pages/my/location-test' }) },
  openOfficialVoip() { wx.navigateTo({ url: '/pages/my/official-voip-test' }) },
  openHardwareLocationTest() { wx.navigateTo({ url: '/pages/my/hardware-location-test' }) },
  demoReady() { return access.familyReady() && api.getDeviceMode() === 'demo' },
  reload() {
    this.clearCloudLocation()
    const demoReady = this.demoReady()
    this.setData({ lab: api.getLabInfo(), demoReady, childName: '', current: 'default', cloudBindings: null })
    if (!store.getSession().privacyAccepted) this.setData({ cloudConnection: null, cloudConnectionError: '', realIdentity: null, realChecks: null, realTargets: [], realSelectedId: '', realStatus: null, realResult: '' })
    if (!demoReady) return Promise.resolve()
    return api.getContext().then((ctx) => {
      if (this.demoReady()) util.safeSetData(this, { current: ctx.scenario, childName: ctx.child ? ctx.child.name : '未绑定' })
    }).catch(util.failToast)
  },
  inputPair(e) { this.setData({ pairCode: e.detail.value.trim().toUpperCase() }) },
  inputRemark(e) { this.setData({ remark: e.detail.value }) },
  realTarget() {
    const target = this.data.realTargets.find(x => x.deviceId === this.data.realSelectedId)
    if (!target) throw { code: 'DEVICE_UNBOUND', message: '请先读取并选择后台已授权的测试设备；不能使用本地示例孩子' }
    return { familyId: target.familyId, childId: target.childId, deviceId: target.deviceId, bindingVersion: target.bindingVersion }
  },
  async realAction(work, kind = '') {
    if (this.data.busy) return
    if (kind !== 'location') this.clearCloudLocation()
    if (!store.getSession().privacyAccepted) { access.requestLogin('guard'); return }
    const version = util.beginRequest(this, 'real-setup')
    this.setData({ busy: true, realResult: '', activeRealAction: kind, ...(kind === 'connection' ? { cloudConnection: null, cloudConnectionError: '' } : {}) })
    try {
      const patch = await work()
      if (store.getSession().privacyAccepted && util.isRequestCurrent(this, 'real-setup', version)) util.safeSetData(this, patch || {})
    } catch(e) {
      const message = kind === 'connection' && e.code === 'REQUEST_TIMEOUT' ? '连接检查超时（约 12 秒）。暂时无法确认云端后台和数据库是否可用，请稍后重试；这不是密码错误提示。' : e.message || '接入操作失败，请重试'
      if (util.isRequestCurrent(this, 'real-setup', version)) util.safeSetData(this, { realResult: message, realStatus: null, cloudConnection: null, cloudBindings: null, ...(kind === 'connection' ? { cloudConnectionError: message } : {}) })
    } finally {
      // A session/child change invalidates results, but must not leave the page
      // permanently busy. Never unlock a newer request started in the meantime.
      if (this.__requestVersions && this.__requestVersions['real-setup'] === version) util.safeSetData(this, { busy: false })
    }
  },
  checkCloudConnection() { return this.realAction(async () => {
    const result = await api.checkCloudConnection()
    return { cloudConnection: result, realResult: result.storageReady ? '业务后台与私有数据库已响应；设备与音视频仍未验证。' : '业务后台已响应；私有数据库未准备好，暂不能读取真实设备。' }
  }, 'connection') },
  loadCloudBindings() {
    if (this.data.busy) return
    this.setData({ cloudBindings: null })
    return this.realAction(async () => ({ cloudBindings: await api.getCloudBindings() }))
  },
  fetchIdentity() { if (this.data.busy) return; this.setData({ realIdentity: null }); return this.realAction(async () => ({ realIdentity: await api.getRealIdentity(), realResult: '已取得当前 AppID 的真实 OpenID；仅手动复制，不保存到本地缓存。它不是设备密钥。' })) },
  copyIdentity() {
    if (!this.data.realIdentity || !this.data.realIdentity.openid) return
    wx.setClipboardData({ data: this.data.realIdentity.openid, success: () => util.toast('已复制本人 OpenID，请仅发给联调人员'), fail: () => util.toast('复制失败，请重试') })
  },
  checkReadiness() { return this.realAction(async () => ({ realChecks: await api.getVoipReadiness(), realResult: '已读取后台准备状态。微信平台权限和真实音视频仍须单独验证。' })) },
  loadRealTargets() { return this.realAction(async () => {
    const rows = await api.getVoipTargets()
    const selected = rows.some(x => x.deviceId === this.data.realSelectedId) ? this.data.realSelectedId : rows[0] && rows[0].deviceId || ''
    return { realTargets: rows, realSelectedId: selected, realStatus: null, realResult: rows.length ? '仅列出双方后台绑定一致、本人有通话权限的设备。' : '暂无可联调设备，请先由管理员建立真实家庭授权，并在探鸽绑定测试设备。' }
  }) },
  selectRealTarget(e) { if (!this.data.busy) this.setData({ realSelectedId: e.currentTarget.dataset.id, realStatus: null, realResult: '' }) },
  authorizeReal() { return this.realAction(async () => ({ realStatus: await api.authorizeDeviceVoip(this.realTarget(), this.data.remark), realResult: '微信授权与探鸽后台同步已确认；尚不代表音视频已接通。' })) },
  retryRealSync() { return this.realAction(async () => ({ realStatus: await api.syncDeviceVoip(this.realTarget(), this.data.remark), realResult: '原授权请求已重新同步，不会重复创建通话。' })) },
  queryRealAuth() { return this.realAction(async () => ({ realStatus: await api.getDeviceVoipStatus(this.realTarget()), realResult: '已分别检查微信权限与后台授权；状态未知时不视为已授权。' })) },
  testRealCall(e) { return this.realAction(async () => {
    const target = this.realTarget()
    if (api.getDeviceMode() !== 'cloud') throw { message: '请先完成配置检查并切换 cloud 模式；本入口不会用模拟通话替代真实测试。' }
    const rows = await api.getGuardChildren()
    if (!rows.some(x => x.id === target.deviceId)) throw { message: '此设备授权已改变，请重新读取设备' }
    await api.selectGuardDevice(target.deviceId)
    wx.navigateTo({ url: '/pages/guard/call?type=' + (e.currentTarget.dataset.type === 'video' ? 'video' : 'voice') })
    return {}
  }) },
  async pairLab() {
    if (this.data.busy) return
    this.setData({ busy: true, labResult: '' })
    try { await api.pairLab(this.data.pairCode); util.safeSetData(this, { pairCode: '', labResult: '本机配对成功：返回守护查看测试连接；通话仅作信令模拟，不传声音和画面。' }) }
    catch(e) { util.safeSetData(this, { labResult: e.message || '配对失败' }) }
    finally { util.safeSetData(this, { busy: false, lab: api.getLabInfo() }) }
  },
  async disconnectLab() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try { await api.disconnectLab(); util.safeSetData(this, { labResult: '已退出本机联调，恢复原配置模式。' }) }
    finally { util.safeSetData(this, { busy: false, lab: api.getLabInfo() }) }
  },
  async pick(e) {
    if (!this.demoReady()) return
    if (this.data.busy) return
    this.setData({ busy: true })
    try { await api.setDemoScenario(e.currentTarget.dataset.id); await this.reload(); util.toast('场景已切换，返回对应页面查看') }
    catch(e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy:false }) }
  },
  input(e) { this.setData({ courseId: e.detail.value.toUpperCase().trim() }) },
  async inject() {
    if (!this.demoReady()) return
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const r = await api.injectDemoEvent({ type:'course-completed', courseId:this.data.courseId, id:'manual-complete-'+this.data.courseId })
      util.safeSetData(this, { lastResult: r.duplicate ? '此完成记录已存在，覆盖不会重复增加' : '记录已加入：返回首页和成长查看变化；历史报告需重新生成' })
    } catch(e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy:false }) }
  },
  async reset() {
    if (!this.demoReady()) return
    if (!await util.confirm('重置本地示例', '将清除本机示例操作并恢复示例家庭，旧任务全部失效，不影响真实后台。')) return
    await api.resetDemo().then(() => this.reload()).then(() => util.safeSetData(this, { lastResult:'已重置' })).catch(util.failToast)
  },
  onHide() {
    this.clearCloudLocation()
    util.beginRequest(this, 'real-setup')
    this.setData({ busy: false, activeRealAction: '', cloudConnection: null, cloudConnectionError: '', cloudBindings: null, realIdentity: null, realChecks: null, realTargets: [], realSelectedId: '', realStatus: null, realResult: '' })
  },
  onUnload() { clearTimeout(this.cloudLocationExpiry); util.disposePage(this) }
})
