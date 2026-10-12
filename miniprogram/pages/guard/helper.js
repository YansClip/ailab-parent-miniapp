const util = require('../../utils/util')

function init(page) { page.__disposed = false; page.__hidden = false }
function set(page, patch) { if (!page.__hidden) util.safeSetData(page, patch) }
function show(page) { init(page); set(page, { busy: false }); if (page._pendingTask) resume(page) }
function hide(page) {
  page.__hidden = true
  page._taskVersion = (page._taskVersion || 0) + 1
  if (page._taskPoll && page._taskPoll.cancel) page._taskPoll.cancel()
  Object.keys(page.__requestVersions || {}).forEach((key) => util.beginRequest(page, key))
}
function unload(page) { hide(page); util.disposePage(page) }
function error(page, err) {
  if (err && err.code === 'CANCELLED') return
  set(page, { error: (err && err.message) || '网络不可用，请检查后重试', busy: false, loading: false })
}
function read(page, key, request, apply, options = {}) {
  const version = util.beginRequest(page, key)
  set(page, { loading: !options.quiet, error: '', loadError: false })
  return request().then((value) => {
    if (page.__hidden || !util.isRequestCurrent(page, key, version)) return
    apply(value)
    set(page, { loading: false })
    return value
  }).catch((err) => {
    if (!page.__hidden && util.isRequestCurrent(page, key, version)) { error(page, err); set(page, { loadError: true }) }
  })
}
function resume(page) {
  if (!page._pendingTask || page.__hidden || page.__disposed) return Promise.resolve()
  const version = (page._taskVersion || 0) + 1
  page._taskVersion = version
  if (page._taskPoll && page._taskPoll.cancel) page._taskPoll.cancel()
  set(page, { busy: true, error: '', task: page._pendingTask })
  const poll = util.pollTask(page._pendingTask.id, {
    page,
    onUpdate(task) { if (version === page._taskVersion) set(page, { task }) }
  })
  page._taskPoll = poll
  return poll.then((task) => {
    if (page.__hidden || page.__disposed || version !== page._taskVersion) return
    set(page, { task, busy: false })
    if (task.status === 'success') {
      page._pendingTask = null
      set(page, { result: (task.message || '操作已完成') + (task.synced === false ? '；待设备上线同步，目前尚未在设备生效。' : '') })
      if (page._afterTask) return page._afterTask(task)
    } else if (task.status === 'failed' || task.status === 'cancelled') {
      page._pendingTask = null
      set(page, { error: task.message || '操作失败，原数据未改变，可重试。' })
    } else {
      page._pendingTask = task
      set(page, { error: '尚未确认最终结果，请查询结果后再操作，避免重复提交。' })
    }
  }).catch((err) => {
    if (version === page._taskVersion) error(page, err)
  })
}
function task(page, create, after) {
  if (page.data.busy) return Promise.resolve()
  if (page._pendingTask) return resume(page)
  page._afterTask = after
  set(page, { busy: true, error: '', result: '', task: null })
  return create().then((value) => {
    page._pendingTask = value
    return resume(page)
  }).catch((err) => error(page, err))
}
function action(page, request, apply) {
  const version = util.beginRequest(page, 'action')
  set(page, { busy: true, error: '' })
  return request().then((value) => {
    if (!page.__hidden && util.isRequestCurrent(page, 'action', version)) apply(value)
  }).catch((err) => {
    if (util.isRequestCurrent(page, 'action', version)) error(page, err)
  }).finally(() => {
    if (util.isRequestCurrent(page, 'action', version)) set(page, { busy: false })
  })
}
function verifyContext(page) {
  const api = require('../../services/api')
  set(page, { canManage: false })
  return api.getContext().then((context) => {
    if (page._formChildId && context.childId !== page._formChildId) {
      set(page, { canManage: false, error: '当前孩子已切换，请返回后重新打开此表单，避免修改错误的孩子。' })
      return false
    }
    page._formChildId = context.childId
    set(page, { canManage: context.canManage })
    return true
  }).catch((err) => { error(page, err); set(page, { canManage: false }); return false })
}
function time(ts) {
  if (!ts) return '暂无更新时间'
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}
module.exports = { init, show, hide, unload, set, error, read, task, resume, action, verifyContext, time }
