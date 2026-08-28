function formatRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return s + ' 秒前'
  const m = Math.floor(s / 60)
  if (m < 60) return m + ' 分钟前'
  const h = Math.floor(m / 60)
  if (h < 24) return h + ' 小时前'
  return Math.floor(h / 24) + ' 天前'
}

function toast(title, icon) {
  wx.showToast({ title: title || '已完成', icon: icon || 'none' })
}

function failToast(err) {
  const msg = (err && (err.message || err.errMsg)) || '网络不可用，请稍后重试'
  toast(msg)
}

function confirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmColor: '#40B352',
      success: (res) => resolve(!!res.confirm)
    })
  })
}

function setTab(index) {
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (page && typeof page.getTabBar === 'function' && page.getTabBar()) {
    page.getTabBar().setData({ selected: index })
  }
}

function guardAuth() {
  const store = require('../services/store')
  const s = store.getSession()
  if (!s.privacyAccepted) {
    wx.redirectTo({ url: '/pages/auth/welcome' })
    return false
  }
  if (!s.loggedIn) {
    wx.redirectTo({ url: '/pages/auth/login' })
    return false
  }
  if (!s.familyReady) {
    wx.redirectTo({ url: s.familyCreated ? '/pages/family/bind' : '/pages/family/create' })
    return false
  }
  return true
}

function statusBarHeight() {
  const app = getApp()
  return (app && app.globalData && app.globalData.statusBarHeight) || 44
}

function withLoading(page, promise, key) {
  const loadingKey = key || 'loading'
  page.setData({ [loadingKey]: true })
  return Promise.resolve(promise)
    .catch((err) => {
      failToast(err)
      throw err
    })
    .finally(() => page.setData({ [loadingKey]: false }))
}

function pollTask(id, opts) {
  opts = opts || {}
  const interval = opts.interval || 700
  const max = opts.max || 12
  const onUpdate = opts.onUpdate
  const api = require('../services/api')
  let n = 0
  return new Promise((resolve, reject) => {
    function tick() {
      api.getTask(id).then((t) => {
        if (onUpdate) onUpdate(t)
        if (t.status === 'success' || t.status === 'failed' || t.status === 'timeout' || t.status === 'unknown') {
          resolve(t)
          return
        }
        n += 1
        if (n >= max) {
          resolve(t)
          return
        }
        setTimeout(tick, interval)
      }).catch(reject)
    }
    setTimeout(tick, interval)
  })
}

function runTask(page, type, payload) {
  const api = require('../services/api')
  if (page && page.data && page.data.busy) return Promise.resolve(null)
  if (page) page.setData({ busy: true })
  return api.submitTask(type, payload || {}).then((t) => {
    if (page) page.setData({ task: t })
    return pollTask(t.id, {
      onUpdate(x) {
        if (page) page.setData({ task: x })
      }
    }).then((x) => {
      if (page) page.setData({ task: x, busy: false })
      toast(x.message)
      return x
    })
  }).catch((err) => {
    if (page) page.setData({ busy: false })
    failToast(err)
    throw err
  })
}

function acquire(page, key) {
  const k = key || '_busy'
  if (page[k]) return false
  page[k] = true
  return true
}

function release(page, key) {
  page[key || '_busy'] = false
}

module.exports = {
  formatRelative,
  toast,
  failToast,
  confirm,
  setTab,
  guardAuth,
  statusBarHeight,
  withLoading,
  pollTask,
  runTask,
  acquire,
  release
}
