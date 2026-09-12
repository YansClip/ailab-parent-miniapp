const api = require('../../services/api')
const util = require('../../utils/util')
function load(page, fn, map) { if (!util.guardAuth()) return Promise.resolve(null); return util.loadPage(page, fn, map) }
function role(page) { return api.getParent().then((p) => { util.safeSetData(page, { isAdmin: p.role === '主管理员', parent: p }); return p.role === '主管理员' }) }
async function task(page, type, payload, after) {
  const previous = page.data && page.data.task
  const needsQuery = previous && previous.type === type && !previous.completedAt && !previous.result && ['submitted', 'executing', 'timeout'].indexOf(previous.status) >= 0
  const result = needsQuery ? await query(page) : await util.runTask(page, type, payload).catch(() => null)
  if (result && result.status === 'success' && util.pageMounted(page) && after) await after(result)
  return result
}
async function query(page) {
  if (!page.data.task || page.data.busy) return null
  util.safeSetData(page, { busy: true })
  try {
    const result = await util.pollTask(page.data.task.id, { page, onUpdate: (task) => util.safeSetData(page, { task }) })
    util.safeSetData(page, { task: result })
    if (util.pageMounted(page) && result.status !== 'cancelled') util.toast(result.message)
    return result
  } catch (e) { util.failToast(e); return null }
  finally { util.safeSetData(page, { busy: false }) }
}
module.exports = { load, role, task, query }
