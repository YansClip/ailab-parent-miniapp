const api = require('../../services/api')
const access = require('../../services/access')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { guest: true, signedIn: false, statusBarHeight: 44, loc: { child: {}, point: null }, markers: [], relative: '', updatedText: '', batteryText: '—', children: [], showSwitcher: false, refreshing: false, loading: true, error: '', refreshError: '', mapError: false, isCloud: false, isLab: false, integrated: false, selectedId: '', refreshState: '' },
  onShow() {
    helper.show(this)
    util.setTab(1)
    const isCloud = api.getDeviceMode() === 'cloud', isLab = api.getDeviceMode() === 'lab'
    if (!access.signedIn() || (!isCloud && !access.familyReady())) {
      this.clear()
      helper.set(this, { guest: true, signedIn: access.signedIn(), statusBarHeight: util.statusBarHeight(), loading: false, integrated: false, loc: { child: {}, point: null }, markers: [], children: [], selectedId: '', showSwitcher: false, relative: '', updatedText: '', batteryText: '—', refreshing: false, refreshError: '', refreshState: '', error: '' })
      return
    }
    helper.set(this, { guest: false, signedIn: true })
    helper.set(this, { statusBarHeight: util.statusBarHeight(), refreshing: false, isCloud, isLab, integrated: isCloud || isLab, loc: { child: {}, point: null }, markers: [] })
    this.reload()
    this.locationTimer = setInterval(() => this.updateAge(), 10000)
    this._networkListener = (res) => { this._mapNetworkOffline = !res.isConnected; if (!res.isConnected) helper.set(this, { mapError: true }) }
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this._networkListener)
    if (wx.getNetworkType) wx.getNetworkType({ success: (res) => { this._mapNetworkOffline = res.networkType === 'none'; if (this._mapNetworkOffline) helper.set(this, { mapError: true }) } })
  },
  reload(quiet = false) {
    return helper.read(this, 'guard', async () => { const children = await api.getGuardChildren(); return [await api.getLocation(), children] }, ([loc, children]) => {
      const point = loc.status === 'valid' && loc.point && Number.isFinite(loc.point.latitude) && Number.isFinite(loc.point.longitude) ? loc.point : null
      loc.point = point
      helper.set(this, {
        loc, children, selectedId: this.data.integrated ? loc.deviceId : loc.child.id,
        markers: point ? [{ id: 1, latitude: point.latitude, longitude: point.longitude, iconPath: '/assets/icons/lucide/online.png', width: 32, height: 32, callout: { content: (loc.child.shortName || '孩子') + (this.data.isLab ? ' · 联调点位（未认证）' : this.data.isCloud ? ' · 当前设备点位' : ' · 演示点位'), display: 'ALWAYS', borderRadius: 8, padding: 8, color: '#123653', bgColor: '#ffffff' } }] : [],
        relative: util.formatRelative(loc.updatedAt), updatedText: helper.time(loc.updatedAt), batteryText: loc.battery === 0 || loc.battery ? String(loc.battery) + '%' : '—', mapError: !!this._mapNetworkOffline
      })
      if (this.expiryTimer) clearTimeout(this.expiryTimer)
      this.expiryTimer = null
      if (this.data.integrated && point) this.expiryTimer = setTimeout(() => this.updateAge(), Math.max(0, loc.remainingMs))
      if (this.data.integrated && !this.watchTimer && !this._watchStarting && (loc.online || this.data.isLab)) this.startWatch()
    }, { quiet: quiet === true && !this.data.error }).then(result => {
      if (!this.__hidden && this.data.error) helper.set(this, { loc: { child: {}, point: null }, markers: [], updatedText: '', relative: '', batteryText: '—' })
      return result
    })
  },
  startWatch() {
    this._watchStarting = true
    const version = this._watchVersion || 0
    api.watchLocation(false).then((lease) => {
      if (this.__hidden || version !== (this._watchVersion || 0)) { api.watchLocation(true, lease).catch(() => {}); return }
      if (!lease) return
      this.watchTimer = setTimeout(() => {
        this.watchTimer = null
        if (!this.__hidden) this.reload(true)
      }, Math.max(1000, lease.pollMs))
    }).catch((err) => { if (!this.__hidden) helper.set(this, { refreshError: err.message || '自动更新暂不可用，请手动刷新' }) }).finally(() => { this._watchStarting = false })
  },
  onRefresh(fromPoll) {
    if (this.data.refreshing || this.data.loading) return
    if (this.refreshPoll) clearTimeout(this.refreshPoll)
    this.refreshPoll = null
    if (fromPoll !== true) this.refreshPollCount = 0
    const version = util.beginRequest(this, 'refresh')
    helper.set(this, { refreshing: true, refreshError: '', refreshState: this.data.isLab || this.data.loc.refreshMode === 'wait-next-report' ? '等待下一条设备上报；没有下发定位指令…' : '正在请求新定位…' })
    api.refreshLocation().then((res) => {
      if (!util.isRequestCurrent(this, 'refresh', version) || this.__hidden) return
      if (res && res.ok === false) throw { message: res.message || '刷新未成功，请重试' }
      if (this.data.integrated && res.state !== 'success') {
        const stateText = { submitted: '已提交，等待设备采集新位置。', accepted: '设备已收到请求，等待新点位。', executing: '正在定位，请稍后查询结果。', timeout: '定位结果待确认，请查询原请求，不会重复下发。', failed: '定位失败，请重试。', cancelled: '定位请求已取消。' }
        const passive = res.refreshMode === 'wait-next-report'
        helper.set(this, { refreshState: passive ? res.state === 'timeout' ? '等待新定位超时，可再次等待；没有向设备下发指令。' : '等待设备下一次有效定位上报；没有向设备下发指令。' : this.data.isLab ? res.state === 'timeout' ? '等待上报超时；可再次等待，未向硬件下发指令。' : res.message : stateText[res.state] || '等待定位结果。' })
        if (['submitted', 'accepted', 'executing'].includes(res.state) && (this.refreshPollCount || 0) < 30) {
          this.refreshPollCount = (this.refreshPollCount || 0) + 1
          this.refreshPoll = setTimeout(() => { if (!this.__hidden) this.onRefresh(true) }, 2000)
        }
        return
      }
      helper.set(this, { refreshState: this.data.isLab ? '已收到下一条上报；设备实际采集时间仍未知' : '已收到新的定位结果' })
      return this.reload()
    }).catch((err) => {
      if (util.isRequestCurrent(this, 'refresh', version)) helper.set(this, { refreshError: err.message || '位置刷新失败，请重试' })
    }).finally(() => { if (util.isRequestCurrent(this, 'refresh', version)) helper.set(this, { refreshing: false }) })
  },
  onMapError() { helper.set(this, { mapError: true }) },
  updateAge() {
    if (this.__hidden || !this.data.loc.updatedAt) return
    const loc = this.data.loc
    helper.set(this, { relative: util.formatRelative(loc.updatedAt) })
    const expired = this.data.integrated ? Date.now() - loc.receivedAt >= loc.remainingMs : Date.now() >= loc.expiresAt
    if (loc.point && expired) helper.set(this, { loc: Object.assign({}, loc, { point: null, status: 'stale', label: '位置已过期', address: null, hint: '旧坐标与地址已清除，请刷新位置。' }), markers: [] })
  },
  retryMap() { helper.set(this, { mapError: false }) },
  openSwitcher() { helper.set(this, { showSwitcher: true }) },
  closeSwitcher() { helper.set(this, { showSwitcher: false }) },
  async onChildChange(e) {
    if (this.data.integrated) {
      try { await api.selectGuardDevice(e.detail.id) } catch (err) { helper.set(this, { refreshError: err.message }); return }
    }
    this.clearWatch()
    util.beginRequest(this, 'refresh')
    helper.set(this, { refreshing: false, refreshError: '', showSwitcher: false, loading: true, loc: { child: {}, point: null }, markers: [], relative: '', batteryText: '—' })
    this.reload()
  },
  go(e) {
    const url = e.currentTarget.dataset.url
    if (this.data.integrated && !url.startsWith('/pages/guard/call')) { util.toast('此工具仍为本地演示，本轮尚未接入真实设备'); return }
    wx.navigateTo({ url })
  },
  clearWatch() { this._watchVersion = (this._watchVersion || 0) + 1; if (this.watchTimer) clearTimeout(this.watchTimer); this.watchTimer = null; if (this.data.integrated) api.watchLocation(true).catch(() => {}) },
  clear() { this.clearWatch(); if (this.expiryTimer) clearTimeout(this.expiryTimer); this.expiryTimer = null; if (this.refreshPoll) clearTimeout(this.refreshPoll); this.refreshPoll = null; if (this.locationTimer) clearInterval(this.locationTimer); this.locationTimer = null; if (wx.offNetworkStatusChange && this._networkListener) wx.offNetworkStatusChange(this._networkListener); this._networkListener = null },
  onHide() { this.clear(); helper.hide(this) },
  onUnload() { this.clear(); helper.unload(this) }
})
