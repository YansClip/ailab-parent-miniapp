const util = require('../../utils/util')
function navigate(url) {
  if (!url) return
  if (['/pages/home/index', '/pages/guard/index', '/pages/growth/index', '/pages/my/index'].indexOf(url.split('?')[0]) >= 0) wx.switchTab({ url: url.split('?')[0] })
  else wx.navigateTo({ url })
}
function groupEvents(events) {
  const groups = []
  const labels = { 'course-completed': '探索完成', 'course-unlocked': '探索解锁', question: '兴趣提问', achievement: '探索成果' }
  ;(events || []).forEach((event) => {
    const date = event.date || (event.timestamp ? new Date(event.timestamp).toISOString().slice(0, 10) : '最近记录')
    let group = groups.find((item) => item.date === date)
    if (!group) { group = { date, items: [] }; groups.push(group) }
    group.items.push(Object.assign({}, event, { typeLabel: labels[event.type] || '陪伴记录' }))
  })
  return groups
}
function errorText(e, fallback) { return (e && (e.message || e.errMsg)) || fallback || '暂时无法加载，请稍后重试' }
function displayDate(value) {
  if (!value) return ''
  if (typeof value !== 'number') return String(value)
  const d = new Date(value)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
function reportPage(defaultId) {
  const api = require('../../services/api')
  return {
    data: { report: {}, busy: false, loading: true, error: '', task: {} },
    onLoad(q) { this.__disposed = false; this.rid = q.id || defaultId },
    onShow() { if (util.guardAuth()) { util.safeSetData(this, { busy: false }); this.load() } },
    load() {
      const version = util.beginRequest(this, 'report')
      util.safeSetData(this, { loading: true, error: '' })
      return api.getReport(this.rid).then((report) => {
        if (!util.isRequestCurrent(this, 'report', version)) return
        util.safeSetData(this, { report, loading: false })
        if (report.status === 'generating' && report.taskId && !this.data.busy) this.watch(report.taskId)
      }).catch((e) => {
        if (util.isRequestCurrent(this, 'report', version)) util.safeSetData(this, { loading: false, error: errorText(e) })
      })
    },
    watch(taskId) {
      const version = util.beginRequest(this, 'reportTask')
      util.safeSetData(this, { busy: true })
      return util.pollTask(taskId, { page: this, onUpdate: (task) => {
        if (util.isRequestCurrent(this, 'reportTask', version)) util.safeSetData(this, { task })
      } }).then((task) => {
        if (!util.isRequestCurrent(this, 'reportTask', version)) return
        if (task.status === 'success') return this.load()
        const status = task.status === 'failed' || task.status === 'timeout' || task.status === 'unknown' ? 'failed' : 'generating'
        util.safeSetData(this, { report: Object.assign({}, this.data.report, { status, message: task.message || '生成尚未完成，可稍后刷新。' }) })
      }).catch((e) => {
        if (util.isRequestCurrent(this, 'reportTask', version)) util.safeSetData(this, { report: Object.assign({}, this.data.report, { status: 'failed', message: errorText(e) }) })
      }).finally(() => {
        if (util.isRequestCurrent(this, 'reportTask', version)) util.safeSetData(this, { busy: false })
      })
    },
    retry() {
      if (this.data.busy) return
      const version = util.beginRequest(this, 'regenerate')
      util.safeSetData(this, { busy: true, report: Object.assign({}, this.data.report, { status: 'generating' }) })
      return api.regenerateReport(this.rid).then((task) => {
        if (util.isRequestCurrent(this, 'regenerate', version)) return this.watch(task.id)
      }).catch((e) => {
        if (util.isRequestCurrent(this, 'regenerate', version)) util.safeSetData(this, { busy: false, report: Object.assign({}, this.data.report, { status: 'failed', message: errorText(e) }) })
      })
    },
    share() {
      const report = this.data.report
      if (report.status !== 'ready') return
      navigate('/pages/growth/share?targetType=report&targetId=' + encodeURIComponent(this.rid) + '&childId=' + encodeURIComponent(report.childId || (report.child && report.child.id) || ''))
    },
    onUnload() { util.disposePage(this) }
  }
}
module.exports = { navigate, groupEvents, errorText, displayDate, reportPage }
