const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { statusBarHeight: 44, loc: { child: {}, point: null }, markers: [], relative: '', updatedText: '', batteryText: '—', children: [], showSwitcher: false, refreshing: false, loading: true, error: '', refreshError: '', mapError: false },
  onShow() {
    helper.show(this)
    util.setTab(1)
    if (!util.guardAuth()) return
    helper.set(this, { statusBarHeight: util.statusBarHeight(), refreshing: false })
    this.reload()
    this.locationTimer = setInterval(() => this.updateAge(), 10000)
    this._networkListener = (res) => { this._mapNetworkOffline = !res.isConnected; if (!res.isConnected) helper.set(this, { mapError: true }) }
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this._networkListener)
    if (wx.getNetworkType) wx.getNetworkType({ success: (res) => { this._mapNetworkOffline = res.networkType === 'none'; if (this._mapNetworkOffline) helper.set(this, { mapError: true }) } })
  },
  reload() {
    return helper.read(this, 'guard', () => Promise.all([api.getLocation(), api.getChildren()]), ([loc, children]) => {
      const point = loc.status === 'valid' && loc.point && Number.isFinite(loc.point.latitude) && Number.isFinite(loc.point.longitude) ? loc.point : null
      loc.point = point
      helper.set(this, {
        loc, children,
        markers: point ? [{ id: 1, latitude: point.latitude, longitude: point.longitude, iconPath: '/assets/icons/lucide/online.png', width: 32, height: 32, callout: { content: (loc.child.shortName || '孩子') + ' · 演示点位', display: 'ALWAYS', borderRadius: 8, padding: 8, color: '#123653', bgColor: '#ffffff' } }] : [],
        relative: util.formatRelative(loc.updatedAt), updatedText: helper.time(loc.updatedAt), batteryText: loc.battery === 0 || loc.battery ? String(loc.battery) + '%' : '—', mapError: !!this._mapNetworkOffline
      })
    })
  },
  onRefresh() {
    if (this.data.refreshing || this.data.loading) return
    const version = util.beginRequest(this, 'refresh')
    helper.set(this, { refreshing: true, refreshError: '' })
    api.refreshLocation().then((res) => {
      if (!util.isRequestCurrent(this, 'refresh', version) || this.__hidden) return
      if (res && res.ok === false) throw { message: res.message || '刷新未成功，请重试' }
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
    if (loc.point && Date.now() - loc.updatedAt > 5 * 60000) helper.set(this, { loc: Object.assign({}, loc, { point: null, status: 'stale', label: '位置已过期', hint: '有效期为 5 分钟，旧坐标已清除，请刷新位置。' }), markers: [] })
  },
  retryMap() { helper.set(this, { mapError: false }) },
  openSwitcher() { helper.set(this, { showSwitcher: true }) },
  closeSwitcher() { helper.set(this, { showSwitcher: false }) },
  onChildChange() {
    util.beginRequest(this, 'refresh')
    helper.set(this, { refreshing: false, refreshError: '', showSwitcher: false, loading: true, loc: { child: {}, point: null }, markers: [], relative: '', batteryText: '—' })
    this.reload()
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  clear() { if (this.locationTimer) clearInterval(this.locationTimer); this.locationTimer = null; if (wx.offNetworkStatusChange && this._networkListener) wx.offNetworkStatusChange(this._networkListener); this._networkListener = null },
  onHide() { this.clear(); helper.hide(this) },
  onUnload() { this.clear(); helper.unload(this) }
})
