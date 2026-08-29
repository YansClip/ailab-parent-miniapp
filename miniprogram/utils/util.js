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
  if (err && err.code === 'CANCELLED') return
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
  safeSetData(page, { [loadingKey]: true })
  return Promise.resolve(promise)
    .catch((err) => {
      failToast(err)
      throw err
    })
    .finally(() => safeSetData(page, { [loadingKey]: false }))
}

function currentPage() {
  if (typeof getCurrentPages !== 'function') return null
  const pages = getCurrentPages()
  return pages[pages.length - 1] || null
}

function pageMounted(page) {
  if (!page || page.__disposed) return false
  if (typeof getCurrentPages !== 'function') return true
  return getCurrentPages().indexOf(page) >= 0
}

function safeSetData(page, patch, cb) {
  if (!pageMounted(page) || typeof page.setData !== 'function') return false
  page.setData(patch, cb)
  return true
}

function beginRequest(page, key) {
  const name = key || 'default'
  page.__requestVersions = page.__requestVersions || {}
  const next = (page.__requestVersions[name] || 0) + 1
  page.__requestVersions[name] = next
  return next
}

function isRequestCurrent(page, key, version) {
  return pageMounted(page) && page.__requestVersions && page.__requestVersions[key || 'default'] === version
}

function disposePage(page) {
  if (!page) return
  page.__disposed = true
  const jobs = page.__cancelJobs || []
  jobs.splice(0).forEach((cancel) => {
    try { cancel() } catch (e) { console.warn('[AILab async] cancel failed', e) }
  })
}

function pollTask(id, opts) {
  opts = opts || {}
  const interval = opts.interval || 700
  const max = opts.max || 12
  const onUpdate = opts.onUpdate
  const owner = opts.page || currentPage()
  const api = require('../services/api')
  let n = 0
  let timer = null
  let cancelled = false
  const promise = new Promise((resolve, reject) => {
    function tick() {
      if (cancelled || (owner && !pageMounted(owner))) return
      api.getTask(id).then((t) => {
        if (cancelled || (owner && !pageMounted(owner))) return
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
        timer = setTimeout(tick, interval)
      }).catch(reject)
    }
    timer = setTimeout(tick, interval)
  })
  promise.cancel = function () {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
  if (owner) {
    owner.__cancelJobs = owner.__cancelJobs || []
    owner.__cancelJobs.push(promise.cancel)
  }
  return promise
}

function runTask(page, type, payload) {
  const api = require('../services/api')
  if (page && page.data && page.data.busy) return Promise.resolve(null)
  if (page) safeSetData(page, { busy: true })
  return api.submitTask(type, payload || {}).then((t) => {
    if (page) safeSetData(page, { task: t })
    return pollTask(t.id, {
      page,
      onUpdate(x) {
        if (page) safeSetData(page, { task: x })
      }
    }).then((x) => {
      if (page) safeSetData(page, { task: x, busy: false })
      toast(x.message)
      return x
    })
  }).catch((err) => {
    if (page) safeSetData(page, { busy: false })
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
  release,
  safeSetData,
  beginRequest,
  isRequestCurrent,
  disposePage
}
