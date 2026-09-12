const shared = require('./page-utils')
const report = shared.reportPage('p1')
Page(Object.assign({}, report, {
  load() { return report.load.call(this) },
  retry() { return report.retry.call(this) },
  share() { return report.share.call(this) }
}))
