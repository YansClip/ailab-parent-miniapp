const store = require('./store')
const curriculum = require('./curriculum')
const DAY = 86400000
const DB_KEY = 'v3.database'
const V = curriculum.versions
let clock = () => Date.now()
const now = () => clock()
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value))
const date = (value) => { const d = new Date(value); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') }
const stamp = (value) => date(value) + ' ' + new Date(value).toTimeString().slice(0, 5)
const meta = (value) => Object.assign({}, V, value)
function error(code, message) { throw { code, message } }
const CHILDREN = [
  { id: 'child-xiaoman', name: '林小满', shortName: '小满', age: 11, avatarText: '满', days: 126, deviceId: 'dev-mini-01', deviceName: 'Mini 01', online: true, battery: 68, avatarColor: '#227BB8' },
  { id: 'child-xinghe', name: '陈星河', shortName: '星河', age: 14, avatarText: '河', days: 41, deviceId: 'dev-mini-02', deviceName: 'Mini 02', online: false, battery: 18, avatarColor: '#C99938' }
]
const DEFAULT_CONTACTS = [
  { id: 'c1', name: '陈然', relation: '妈妈', phone: '138****2160', deviceCall: true, synced: true },
  { id: 'c2', name: '林屿', relation: '爸爸', phone: '139****8801', deviceCall: true, synced: true },
  { id: 'c3', name: '周老师', relation: '老师', phone: '137****4412', deviceCall: false, synced: true }
]
const DEFAULT_ALARMS = [
  { id: 'al1', time: '07:20', label: '起床', repeat: '周一至周五', enabled: true, synced: true },
  { id: 'al2', time: '21:00', label: '晚安', repeat: '每天', enabled: true, synced: true }
]
const POINT = { latitude: 23.0597, longitude: 113.3640, name: '广州市番禺区 · 广东科学中心附近', accuracy: 18 }
const SCENARIOS = ['default', 'empty', 'loading', 'offline', 'stale', 'fail', 'timeout', 'generating', 'call-rejected', 'call-busy', 'call-interrupted', 'device-offline', 'device-online']
const ADMIN_TASKS = ['family-create', 'child-bind', 'child-unbind', 'device-unbind', 'device-bind', 'admin-transfer', 'invite-accept', 'invite-reject', 'contact-sync', 'contact-delete', 'alarm-save', 'alarm-delete', 'sos-update', 'data-delete', 'child-data-request', 'consent-withdraw']
const TASK_TYPES = ADMIN_TASKS.concat(['account-cancel', 'voice-call', 'find-device', 'find-stop', 'report-regen', 'subscription-update', 'feedback'])
function seedEvents(childId) {
  const base = now()
  const rows = childId === 'child-xiaoman'
    ? [['complete-B01', 'course-completed', 'B01', 12], ['complete-B02', 'course-completed', 'B02', 9], ['complete-B03', 'course-completed', 'B03', 3], ['complete-S01', 'course-completed', 'S01', 1], ['fp1', 'question', 'S01', 0], ['a1', 'achievement', 'B03', 2], ['a2', 'achievement', 'S01', 1]]
    : [['complete-B01', 'course-completed', 'B01', 2]]
  return rows.map(([id, type, courseId, days]) => meta({ id, childId, type, courseId, occurredAt: base - days * DAY, source: '本地探索记录', title: type === 'question' ? '为什么轻轻触摸也能让机器人回应？' : '', summary: type === 'question' ? '比较了轻触和靠近两种输入，记录了触发条件。' : '', verified: type === 'question', verificationText: type === 'question' ? '对照了轻触、靠近两种输入，并记录各自的触发结果。' : '', followups: type === 'question' ? 2 : 0, concepts: type === 'question' ? ['电容触摸', '阈值'] : [] }))
}
function database() {
  let db = store.getDemoData(DB_KEY, null)
  if (!db || db.schema !== 1) {
    db = { schema: 1, sequence: 0, children: clone(CHILDREN), events: {}, calls: {}, finds: {}, locations: {}, reports: {}, codes: {}, feedbacks: [], requests: {}, version: V }
    CHILDREN.forEach((c) => { db.events[c.id] = seedEvents(c.id) })
    save(db)
  }
  return clone(db)
}
function save(db) { store.setDemoData(DB_KEY, db) }
function nextId(prefix) { const db = database(); db.sequence += 1; save(db); return prefix + '-' + now() + '-' + db.sequence }
function children() {
  const hidden = store.getDemoData('unboundChildren', [])
  const unbound = store.getDemoData('unboundDevices', [])
  return database().children.filter((c) => !hidden.includes(c.id)).map((c) => meta(Object.assign({}, c, { deviceBound: !unbound.includes(c.deviceId), online: !unbound.includes(c.deviceId) && c.online && store.getScenario() !== 'device-offline' })))
}
function actor() {
  const s = store.getSession()
  if (!s.loggedIn || !s.privacyAccepted) error('AUTH_REQUIRED', '请先完成隐私确认与登录')
  return s
}
function context(childId) {
  const s = actor()
  const list = children()
  const id = childId || store.getCurrentChildId()
  const child = list.find((item) => item.id === id)
  if (!child) error('CHILD_NOT_FOUND', '当前孩子关系已失效，请重新选择')
  return meta({ childId: child.id, deviceId: child.deviceId, familyId: s.familyId, parentId: s.parentId, role: s.role, epoch: store.getEpoch(), child, children: list, scenario: store.getScenario(), isDemo: true, canManage: s.role === '主管理员', permissions: { manageFamily: s.role === '主管理员', manageDevice: s.role === '主管理员', configureDevice: s.role === '主管理员', controlDevice: true, viewGrowth: true } })
}
function requireAdmin(c) { if (!c.canManage) error('FORBIDDEN', '仅主管理员可以执行此操作') }
function requireDevice(c, online) {
  if (!c.child.deviceBound) error('DEVICE_UNBOUND', '尚未绑定设备，请先完成绑定')
  if (online && !c.child.online) error('DEVICE_OFFLINE', '设备离线，请在恢复在线后重试')
}
function reply(fn, options) {
  options = options || {}
  const epoch = store.getEpoch(), childId = store.getCurrentChildId()
  return Promise.resolve().then(() => {
    if (!options.local && store.getScenario() === 'offline') error('OFFLINE', '网络不可用，操作尚未提交，请稍后重试')
    if (!options.skipReconcile) reconcile()
    return fn()
  }).then((result) => new Promise((resolve, reject) => {
    const deliver = () => {
      const allowChanged = typeof options.allowChanged === 'function' ? options.allowChanged(result) : options.allowChanged
      if (!allowChanged && (store.getEpoch() !== epoch || store.getCurrentChildId() !== childId)) { reject({ code: 'STALE_CONTEXT', message: '当前家庭或孩子已变更，请重新加载' }); return }
      resolve(clone(result))
    }
    if (!options.local && store.getScenario() === 'loading') setTimeout(deliver, 1200)
    else deliver()
  }))
}
function contacts(c) { return clone(store.getDemoData('contacts.' + c.childId, DEFAULT_CONTACTS)).map((item) => meta(Object.assign({}, item, { childId: c.childId }))) }
function alarms(c) { return clone(store.getDemoData('alarms.' + c.childId, DEFAULT_ALARMS)).map((item) => meta(Object.assign({}, item, { childId: c.childId }))) }
function events(c) { return store.getScenario() === 'empty' ? [] : (database().events[c.childId] || []).filter((e) => e.childId === c.childId) }
function lesson(id) { return curriculum.courses.find((x) => x.id === id) }
function plan(c) { return curriculum.planFor(c.child.age) }
function sourceUrl(e) { return e.type === 'achievement' ? '/pages/growth/achievement?id=' + encodeURIComponent(e.id) : e.type === 'question' ? '/pages/home/footprint?id=' + encodeURIComponent(e.id) : '/pages/growth/index' }
function eventTitle(e) { return e.title || (e.type === 'achievement' ? '探索成果 · ' : e.type === 'course-unlocked' ? '已解锁 · ' : '完成探索内容 · ') + ((lesson(e.courseId) || {}).title || e.courseId) }
function evidence(e) { return meta({ id: e.id, type: e.type, title: eventTitle(e), date: date(e.occurredAt), occurredAt: e.occurredAt, courseId: e.courseId, source: e.source, url: sourceUrl(e), childId: e.childId }) }
function growth(c, options) {
  options = options || {}
  const at = options.at == null ? now() : options.at
  const list = options.events || events(c), lessons = plan(c)
  const completed = new Map()
  list.filter((e) => e.type === 'course-completed' && lessons.some((l) => l.id === e.courseId)).sort((a, b) => a.occurredAt - b.occurredAt).forEach((e) => { if (!completed.has(e.courseId)) completed.set(e.courseId, e) })
  const boundary = at - 7 * DAY
  const recent = Array.from(completed.values()).filter((e) => e.occurredAt >= boundary)
  const unlocked = list.filter((e) => e.type === 'course-unlocked').map((e) => e.courseId)
  const dimensions = curriculum.dimensions.map((dim, i) => {
    const related = lessons.filter((l) => l.coverage[i] > 0)
    const done = related.filter((l) => completed.has(l.id))
    const week = done.filter((l) => completed.get(l.id).occurredAt >= boundary)
    return meta(Object.assign({}, dim, { value: Math.round(done.length / related.length * 100), delta: Math.round(week.length / related.length * 100), insufficient: list.length === 0, completed: done.length, total: related.length, evidence: done.map((l) => evidence(completed.get(l.id))), description: '本演示探索内容目录中，与“' + dim.name + '”有关的内容已首次完成 ' + done.length + ' 项，共 ' + related.length + ' 项。覆盖率只反映探索内容参与进度，不代表能力测评。', relatedLessons: related.map((l) => ({ id: l.id, title: l.title, completed: completed.has(l.id), coverageLevel: l.coverage[i] })) }))
  })
  const questions = list.filter((e) => e.type === 'question').sort((a, b) => b.occurredAt - a.occurredAt)
  const achievements = list.filter((e) => e.type === 'achievement').map((e) => Object.assign(evidence(e), { time: date(e.occurredAt), image: imageFor(e.courseId) }))
  const range = date(boundary) + ' – ' + date(at)
  const last = questions[0]
  return meta({ child: c.child, childId: c.childId, empty: list.length === 0, progress: { completed: completed.size, total: lessons.length, percent: Math.round(completed.size / lessons.length * 100), delta: recent.length },
    plan: lessons.map((l) => meta({ id: l.id, courseId: l.id, title: l.title, module: l.module, webLevelId: l.webLevelId, status: completed.has(l.id) ? 'completed' : unlocked.includes(l.id) || l.prerequisites.every((id) => completed.has(id)) ? 'available' : 'locked', completedAt: completed.has(l.id) ? completed.get(l.id).occurredAt : null, relatedDimensions: curriculum.dimensions.filter((_, i) => l.coverage[i] > 0).map((d) => d.key) })),
    dimensions, insight: { range, change: recent.length ? '近 7 天首次完成 ' + recent.length + ' 项探索内容' : '近 7 天暂无新增完成探索内容', achievements: achievements.length, activity: list.filter((e) => e.occurredAt >= boundary).length ? '有探索记录' : '暂无记录', questions: questions.filter((e) => e.occurredAt >= boundary).length },
    brief: last ? { status: 'ready', date: date(last.occurredAt), theme: (lesson(last.courseId) || {}).title || '', summary: last.summary || '', body: [last.summary, last.verificationText].filter(Boolean).join('\n'), relatedEvents: [evidence(last)], question: last.title, followups: last.followups || 0, concepts: last.concepts || [], verified: !!last.verified, verificationText: last.verificationText || '', tip: '可以请孩子说说这次记录中的观察与理由。', eventId: last.id } : { status: 'insufficient', reason: '还没有代表性提问记录，暂不生成成长简报。' },
    briefHistory: questions.map(evidence),
    reports: list.length && !options.withoutReports ? [{ id: 'w1', type: 'weekly', title: '成长周报', range }, { id: 'p1', type: 'phase', title: '阶段成长报告', range: '当前演示探索内容目录' }].map((item) => { const state = reportState(c, item.id); return Object.assign(item, { range: state.snapshot ? state.snapshot.range : item.range, status: state.status }) }) : [], achievements, timeline: list.slice().sort((a, b) => b.occurredAt - a.occurredAt).map(evidence)
  })
}
function imageFor(courseId) { return courseId && courseId[0] === 'S' ? '/assets/illustrations/result-sound-v2.jpg' : '/assets/illustrations/result-robot-arm-v2.jpg' }
function buildReportSnapshot(c, id, cutoffAt) {
  const sourceEvents = clone(events(c).filter((e) => e.occurredAt <= cutoffAt))
  const g = growth(c, { withoutReports: true, events: sourceEvents, at: cutoffAt })
  const periodRows = id === 'w1' ? sourceEvents.filter((e) => e.occurredAt >= cutoffAt - 7 * DAY) : sourceEvents
  return meta({
    schema: 1, id, childId: c.childId, child: clone(c.child), cutoffAt,
    title: id === 'w1' ? '成长周报' : '阶段成长报告',
    range: id === 'w1' ? g.insight.range : '当前演示探索内容目录 · ' + g.progress.total + ' 项',
    sufficiency: periodRows.length ? '依据 ' + periodRows.length + ' 条探索记录' : '本期记录不足',
    sourceEventIds: periodRows.map((e) => e.id), sourceEvents,
    progress: clone(g.progress), dimensions: clone(g.dimensions),
    sections: [
      { title: '探索进度', body: '首次完成 ' + g.progress.completed + ' / ' + g.progress.total + ' 项探索内容，近 7 天新增 ' + g.progress.delta + ' 项。重复完成和解锁不重复计数。' },
      { title: '代表记录', body: periodRows.length ? periodRows.slice(-3).map(eventTitle).join('；') : '本期暂无有效探索事件，不形成结论。' },
      { title: '统计口径', body: '六维展示已完成探索内容的相关内容覆盖率，不是能力测评。探索内容目录 V3.1；本地目录和 Web 关卡映射仅用于演示。' }
    ]
  })
}
function reportState(c, id) {
  const db = database(), key = c.childId + '.' + id
  const previous = db.reports[key]
  if (previous && (previous.status !== 'ready' || previous.snapshot)) return previous
  const state = previous ? Object.assign({}, previous) : { status: store.getScenario() === 'generating' ? 'generating' : 'ready', version: 1 }
  if (state.status === 'ready') {
    // Legacy ready records did not preserve their inputs. Create an explicit new
    // snapshot revision instead of attaching new content to an old generation time.
    if (previous) state.version = (previous.version || 1) + 1
    state.generatedAt = now()
    state.snapshot = buildReportSnapshot(c, id, state.generatedAt)
    db.reports[key] = state
    save(db)
  }
  return state
}
function report(c, id) {
  if (!['w1', 'p1'].includes(id) || !events(c).length) error('NOT_FOUND', '当前孩子暂无这份报告')
  const state = reportState(c, id)
  const base = { id, childId: c.childId, child: c.child, title: id === 'w1' ? '成长周报' : '阶段成长报告', sections: [], sourceEventIds: [] }
  const content = state.status === 'ready' ? clone(state.snapshot) : base
  return meta(Object.assign({}, content, { status: state.status, version: state.version, taskId: state.taskId, message: state.message || '', generatedAt: state.generatedAt ? stamp(state.generatedAt) : '', snapshot: state.status === 'ready' ? clone(state.snapshot) : null }))
}
function itemEvent(c, id, type) { const e = events(c).find((x) => x.id === id && x.type === type); if (!e) error('NOT_FOUND', '当前孩子暂无这条记录'); return e }
function achievement(c, id) { const e = itemEvent(c, id, 'achievement'); return meta(Object.assign(evidence(e), { child: c.child, childAlias: c.child.shortName, image: imageFor(e.courseId), process: e.summary || '已保存这项探索内容的探索成果，可回到对应探索记录核对。', evidence: (lesson(e.courseId) || {}).expectedEvidence || '', sourceEventIds: [e.id] })) }
function currentLocation(c) {
  const db = database()
  let point = db.locations[c.childId]
  if (!point && c.child.deviceBound && c.child.online && store.getScenario() !== 'stale') {
    point = { point: POINT, updatedAt: now() - 20000 }
    db.locations[c.childId] = point
    save(db)
  }
  const base = { child: c.child, childId: c.childId, battery: c.child.deviceBound ? c.child.battery : null, online: c.child.online, point: null, updatedAt: point ? point.updatedAt : now() - 20000, sosCount: store.getSosIds(c.childId).length, sosSynced: store.getDemoData('sosSynced.' + c.childId, true), nextAlarm: (alarms(c).filter((a) => a.enabled).sort((a, b) => a.time.localeCompare(b.time))[0] || {}).time || '' }
  if (!c.child.deviceBound) return meta(Object.assign(base, { status: 'unbound', label: '尚未绑定设备', hint: '绑定后可查看位置和使用守护工具', updatedAt: null }))
  if (!c.child.online) return meta(Object.assign(base, { status: 'offline', label: '设备离线', hint: '离线不显示位置点，配置可保存待同步' }))
  if ((!point && store.getScenario() === 'stale') || (point && now() - point.updatedAt > 5 * 60000)) return meta(Object.assign(base, { status: 'stale', label: '位置已过期', hint: '有效期为 5 分钟，刷新后重新获取', updatedAt: point ? point.updatedAt : now() - 20 * 60000 }))
  return meta(Object.assign(base, { status: 'valid', point: point ? point.point : POINT, label: POINT.name, accuracy: POINT.accuracy, hint: '仅显示当前有效位置，不保存历史轨迹' }))
}
function validateTask(type, p, c) {
  if (!TASK_TYPES.includes(type)) error('INVALID_TASK', '不支持的操作')
  if (ADMIN_TASKS.includes(type)) requireAdmin(c)
  if (['contact-sync', 'contact-delete', 'alarm-save', 'alarm-delete', 'sos-update'].includes(type)) requireDevice(c, false)
  if (type === 'child-bind') {
    const code = String(p.code || '')
    if (code === '000000') error('BIND_CODE_EXPIRED', '绑定码已过期')
    if (code === '111111' || database().codes[code]) error('BIND_CODE_USED', '绑定码已被使用')
    if (!['123456', '222222', '333333', '654321'].includes(code)) error('BIND_CODE_INVALID', '绑定码无效，请使用已提供的测试绑定码')
    p.bindChildId = ['123456', '222222'].includes(code) ? 'child-xiaoman' : 'child-xinghe'
  }
  if (type === 'family-create' && (!String(p.name || '').trim() || !String(p.relation || '').trim())) error('INVALID_INPUT', '请填写家庭名称和称谓')
  if (type === 'admin-transfer') {
    if (!p.memberId) p.memberId = 'u2'
    if (!['u2', 'u3'].includes(p.memberId) || (p.memberId === 'u3' && store.getInvites().u3 !== 'accepted')) error('INVALID_MEMBER', '接收方必须是已加入家庭的其他成员')
  }
  if (type === 'child-data-request') {
    if (!p.action) p.action = 'view'
    if (!['view', 'correct'].includes(p.action)) error('INVALID_INPUT', '请选择查看或更正资料')
    if (p.action === 'correct' && (!String(p.name || '').trim() || String(p.name).trim().length > 20)) error('INVALID_INPUT', '孩子姓名应为 1 至 20 个字符')
  }
  if (type === 'device-bind') {
    p.id = p.id || p.deviceId || c.deviceId
    if (!children().some((x) => x.deviceId === p.id)) error('DEVICE_NOT_FOUND', '只能恢复家庭已关联的设备，新设备请使用绑定码')
  }
  if (type === 'contact-sync') {
    const old = contacts(c).find((x) => x.id === p.id)
    if (!String(p.name || '').trim() || !String(p.relation || '').trim()) error('INVALID_INPUT', '请填写联系人姓名和关系')
    if (!/^1[3-9]\d{9}$/.test(p.phone || '') && !(old && old.phone === p.phone && /^1\d{2}\*{4}\d{4}$/.test(p.phone))) error('INVALID_PHONE', '请输入有效手机号')
    if (!p.deviceCall && store.getSosIds(c.childId).includes(p.id)) error('SOS_REFERENCED', '请先从紧急联系人中移除')
  }
  if (type === 'contact-delete' && store.getSosIds(c.childId).includes(p.id)) error('SOS_REFERENCED', '请先从紧急联系人中移除')
  if (type === 'contact-delete' && !contacts(c).some((x) => x.id === p.id)) error('NOT_FOUND', '联系人不存在或已经删除')
  if (type === 'alarm-delete' && !alarms(c).some((x) => x.id === p.id)) error('NOT_FOUND', '闹钟不存在或已经删除')
  if (type === 'sos-update') {
    if (!Array.isArray(p.ids) || p.ids.length < 1 || p.ids.length > 3 || new Set(p.ids).size !== p.ids.length) error('INVALID_SOS', '请选择 1 至 3 名不同的紧急联系人')
    if (p.ids.some((id) => !contacts(c).some((x) => x.id === id && x.deviceCall))) error('INVALID_SOS', '紧急联系人必须已开启设备通话')
  }
  if (type === 'alarm-save' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time || '') || !String(p.label || '').trim())) error('INVALID_ALARM', '请填写有效的闹钟时间和名称')
  if (type === 'child-unbind' && (children().length <= 1 || !children().some((x) => x.id === p.id))) error('INVALID_CHILD', '家庭中至少保留一名有效孩子')
  if (type === 'device-unbind' && !children().some((x) => x.deviceId === p.id && x.deviceBound)) error('DEVICE_NOT_FOUND', '设备不存在或已经解绑')
  if (['invite-accept', 'invite-reject'].includes(type) && (p.id !== 'u3' || store.getInvites().u3 !== 'pending')) error('INVITE_NOT_PENDING', '邀请不存在或已处理')
  if (type === 'report-regen') report(c, p.id || 'w1')
  if (type === 'feedback' && !String(p.text || p.content || '').trim()) error('INVALID_FEEDBACK', '请先填写反馈内容')
}
function message(type, status, synced) {
  if (status === 'submitted') return '请求已提交'
  if (status === 'executing') return '正在处理'
  if (status === 'failed') return '处理失败，原数据未改变'
  if (status === 'timeout') return '暂未收到结果，可再次查询最终状态'
  if (status === 'cancelled') return '会话已变更，操作已取消'
  const names = { 'family-create': '家庭已创建', 'child-bind': '孩子和设备绑定成功', 'child-unbind': '孩子关系已解除', 'device-unbind': '设备已解绑', 'admin-transfer': '主管理员已转移', 'invite-accept': '已同意加入家庭', 'invite-reject': '已拒绝邀请', 'contact-sync': '联系人已保存', 'contact-delete': '联系人已删除', 'alarm-save': '闹钟已保存', 'alarm-delete': '闹钟已删除', 'sos-update': '紧急联系人已保存', 'report-regen': '成长报告已重新生成', 'feedback': '反馈已保存', 'subscription-update': '提醒设置已保存', 'data-delete': '当前孩子的本地探索记录已删除', 'consent-withdraw': '已撤回本机同意，请重新确认后登录', 'account-cancel': '本地账号已注销', 'child-data-request': '儿童信息申请已受理', 'voice-call': '语音连接已建立', 'find-device': '设备已开始响铃', 'find-stop': '响铃已停止' }
  names['device-bind'] = '设备已重新绑定'
  names.feedback = '反馈已保存至本机，未发送真实客服'
  names['child-data-request'] = '儿童资料本地操作已完成'
  return (names[type] || '处理已完成') + (synced === false ? '，设备离线，待同步' : '')
}
function applyMutation(task) {
  const p = task.payload, c = context(task.childId)
  validateTask(task.type, p, c)
  const db = database(), type = task.type
  let synced
  if (['contact-sync', 'contact-delete', 'alarm-save', 'alarm-delete', 'sos-update'].includes(type)) synced = c.child.online
  if (type === 'contact-sync') {
    const list = contacts(c), item = { id: p.id, name: p.name.trim(), relation: p.relation.trim(), phone: p.phone, deviceCall: !!p.deviceCall, synced }
    store.setDemoData('contacts.' + c.childId, list.filter((x) => x.id !== item.id).concat(item))
  }
  if (type === 'contact-delete') store.setDemoData('contacts.' + c.childId, contacts(c).filter((x) => x.id !== p.id))
  if (type === 'alarm-save') store.setDemoData('alarms.' + c.childId, alarms(c).filter((x) => x.id !== p.id).concat({ id: p.id, time: p.time, label: p.label.trim(), repeat: p.repeat || '仅一次', enabled: !!p.enabled, synced }))
  if (type === 'alarm-delete') store.setDemoData('alarms.' + c.childId, alarms(c).filter((x) => x.id !== p.id))
  if (type === 'sos-update') { store.setSosIds(p.ids, c.childId); store.setDemoData('sosSynced.' + c.childId, synced) }
  if (type === 'family-create') store.setSession({ familyCreated: true, familyName: p.name.trim(), relation: p.relation.trim() })
  if (type === 'child-bind') {
    db.codes[p.code] = { childId: p.bindChildId, usedAt: now() }
    const target = db.children.find((x) => x.id === p.bindChildId)
    store.setDemoData('unboundChildren', store.getDemoData('unboundChildren', []).filter((id) => id !== target.id))
    store.setDemoData('unboundDevices', store.getDemoData('unboundDevices', []).filter((id) => id !== target.deviceId))
    store.setSession({ familyCreated: true, familyReady: true })
  }
  if (type === 'child-unbind') {
    store.setDemoData('unboundChildren', store.getDemoData('unboundChildren', []).concat(p.id))
    if (store.getCurrentChildId() === p.id) store.setCurrentChildId(children()[0].id)
    delete db.calls[p.id]; delete db.finds[p.id]
  }
  if (type === 'device-unbind') { store.setDemoData('unboundDevices', store.getDemoData('unboundDevices', []).concat(p.id)); const target = db.children.find((x) => x.deviceId === p.id); delete db.calls[target.id]; delete db.finds[target.id]; delete db.locations[target.id] }
  if (type === 'device-bind') store.setDemoData('unboundDevices', store.getDemoData('unboundDevices', []).filter((id) => id !== p.id))
  if (type === 'admin-transfer') { store.setSession({ role: '普通成员' }); store.setDemoData('adminMemberId', p.memberId) }
  if (type === 'invite-accept') store.setInvite(p.id, 'accepted')
  if (type === 'invite-reject') store.setInvite(p.id, 'rejected')
  if (type === 'subscription-update') store.setDemoData('subscriptionEnabled', !!p.enabled)
  if (type === 'feedback') db.feedbacks.push(meta({ id: task.id, childId: c.childId, text: String(p.text || p.content).trim(), createdAt: now(), status: 'local-pending', message: '仅保存在本机，未发送真实客服' }))
  if (type === 'report-regen') {
    const rid = p.id || 'w1', key = c.childId + '.' + rid, old = db.reports[key] || {}, generatedAt = now()
    db.reports[key] = { status: 'ready', version: (old.version || 0) + 1, taskId: task.id, generatedAt, snapshot: buildReportSnapshot(c, rid, generatedAt) }
  }
  if (['child-data-request', 'data-delete', 'consent-withdraw', 'account-cancel'].includes(type)) {
    const request = meta({ id: task.id, childId: c.childId, type, status: 'accepted', requestedAt: now(), message: message(type, 'success') })
    db.requests[c.childId + '.' + type] = request
    store.setDemoData('privacyRequests.' + type, request)
    if (type === 'child-data-request') {
      const child = db.children.find((x) => x.id === c.childId)
      if (p.action === 'correct') { child.name = p.name.trim(); child.shortName = p.name.trim(); child.avatarText = p.name.trim().slice(-1) }
      request.action = p.action
      request.child = clone(child)
      request.note = String(p.note || '')
      task.result = clone(request)
    }
    if (type === 'data-delete') { db.events[c.childId] = []; Object.keys(db.reports).filter((k) => k.startsWith(c.childId + '.')).forEach((k) => delete db.reports[k]); store.setDemoData('follows.' + c.childId, {}) }
    if (type !== 'child-data-request') { store.bumpEpoch(); task.finalAfterRevocation = true; db.calls = {}; db.finds = {} }
    if (type === 'consent-withdraw' || type === 'account-cancel') store.setSession({ privacyAccepted: false, loggedIn: false, familyReady: type === 'account-cancel' ? false : store.getSession().familyReady })
    // Cancel only this local account session. Other family members' valid records remain.
  }
  save(db)
  return synced
}
let reconciling = false
function reconcile() {
  if (reconciling) return
  reconciling = true
  try {
    Object.values(store.getTasks()).forEach((t) => {
      if (!t.epoch || ['success', 'failed', 'cancelled'].includes(t.status)) return
      const patch = (value) => store.setTask(t.id, Object.assign({}, t, value))
      if (t.epoch !== store.getEpoch()) { patch({ status: 'cancelled', message: message(t.type, 'cancelled'), finishedAt: now() }); return }
      const elapsed = now() - t.createdAt
      if (elapsed < 500) return
      if (elapsed < 1800) { if (t.status !== 'executing') patch({ status: 'executing', message: message(t.type, 'executing') }); return }
      if (t.outcome === 'timeout' && elapsed < 5000) { if (t.status !== 'timeout') patch({ status: 'timeout', retryable: true, message: message(t.type, 'timeout') }); return }
      if (t.outcome === 'fail') { patch({ status: 'failed', message: message(t.type, 'failed'), finishedAt: now() }); if (t.type === 'report-regen') { const db = database(), key = t.childId + '.' + (t.payload.id || 'w1'); db.reports[key] = Object.assign({}, db.reports[key], { status: 'failed', taskId: t.id, message: '生成失败，可重新提交' }); save(db) }; return }
      try {
        const synced = applyMutation(t)
        patch({ status: 'success', synced, result: t.result, message: message(t.type, 'success', synced), finishedAt: now(), finalAfterRevocation: t.finalAfterRevocation })
      } catch (e) { patch({ status: 'failed', errorCode: e.code || 'FAILED', message: e.message || '处理失败', finishedAt: now() }) }
    })
    if (store.getSession().loggedIn && store.getSession().privacyAccepted) children().filter((child) => child.online).forEach((child) => {
      const c = context(child.id)
      const contactRows = contacts(c), alarmRows = alarms(c)
      if (contactRows.some((x) => x.synced === false)) store.setDemoData('contacts.' + c.childId, contactRows.map((x) => Object.assign({}, x, { synced: true })))
      if (alarmRows.some((x) => x.synced === false)) store.setDemoData('alarms.' + c.childId, alarmRows.map((x) => Object.assign({}, x, { synced: true })))
      if (store.getDemoData('sosSynced.' + c.childId, true) === false) store.setDemoData('sosSynced.' + c.childId, true)
    })
  } finally { reconciling = false }
}
function submit(type, payload) {
  const c = context(), p = clone(payload || {})
  validateTask(type, p, c)
  if (['contact-sync', 'alarm-save'].includes(type) && !p.id) p.id = nextId(type === 'contact-sync' ? 'c' : 'al')
  const pending = Object.values(store.getTasks()).find((t) => t.epoch === c.epoch && t.childId === c.childId && t.type === type && JSON.stringify(t.payload) === JSON.stringify(p) && ['submitted', 'executing', 'timeout'].includes(t.status))
  if (pending) return pending
  const id = nextId('task'), scenario = store.getScenario()
  const task = meta({ id, type, childId: c.childId, deviceId: c.deviceId, parentId: c.parentId, familyId: c.familyId, epoch: c.epoch, payload: p, status: 'submitted', createdAt: now(), outcome: scenario === 'fail' ? 'fail' : scenario === 'timeout' ? 'timeout' : 'success', message: message(type, 'submitted') })
  store.setTask(id, task)
  if (type === 'report-regen') { const db = database(), key = c.childId + '.' + (p.id || 'w1'); db.reports[key] = Object.assign({}, db.reports[key], { status: 'generating', taskId: id, version: (db.reports[key] || {}).version || 1 }); save(db) }
  return task
}
function callSession(c) {
  const db = database(), session = db.calls[c.childId]
  if (!session || session.epoch !== c.epoch) return null
  if (['calling', 'connected'].includes(session.stage) && (!c.child.online || !c.child.deviceBound)) { session.stage = 'interrupted'; session.endedAt = now(); session.reason = '设备连接已中断' }
  if (session.stage === 'calling' && now() >= session.resolveAt) {
    session.stage = session.outcome
    if (session.stage === 'connected') session.connectedAt = session.resolveAt
    else { session.endedAt = session.resolveAt; session.reason = { rejected: '设备端拒绝了通话', busy: '设备正忙，请稍后重试', timeout: '等待接听超时', failed: '连接失败，请重试' }[session.stage] }
  }
  if (session.stage === 'connected' && session.interruptAt && now() >= session.interruptAt) { session.stage = 'interrupted'; session.reason = '模拟设备连接中断'; session.endedAt = session.interruptAt }
  db.calls[c.childId] = session; save(db); return session
}
function findSession(c) {
  const db = database(), session = db.finds[c.childId]
  if (!session || session.epoch !== c.epoch) return null
  if (session.stage === 'ringing' && now() >= session.endsAt) { session.stage = 'expired'; session.endedAt = session.endsAt; session.reason = '60 秒响铃已自动结束' }
  if (session.stage === 'ringing' && (!c.child.deviceBound || !c.child.online)) { session.stage = 'stopped'; session.endedAt = now(); session.reason = '设备连接中断，响铃状态已结束' }
  db.finds[c.childId] = session; save(db); return session
}
function startCall() {
  const c = context(); requireDevice(c, true)
  const old = callSession(c)
  if (old && ['calling', 'connected'].includes(old.stage)) return old
  const scenario = store.getScenario(), created = now()
  const outcome = { 'call-rejected': 'rejected', 'call-busy': 'busy', timeout: 'timeout', fail: 'failed' }[scenario] || 'connected'
  const item = meta({ id: nextId('call'), childId: c.childId, deviceId: c.deviceId, epoch: c.epoch, stage: 'calling', startedAt: created, connectedAt: null, endedAt: null, reason: '', muted: false, speaker: false, nr: false, resolveAt: created + (outcome === 'timeout' ? 8000 : 1800), outcome, interruptAt: scenario === 'call-interrupted' ? created + 7000 : null })
  const db = database(); db.calls[c.childId] = item; save(db); return item
}
function startFinding() {
  const c = context(); requireDevice(c, true)
  const old = findSession(c)
  if (old && old.stage === 'ringing') return old
  if (store.getScenario() === 'fail') error('DEVICE_FAILED', '设备未接受响铃请求，请重试')
  if (store.getScenario() === 'timeout') error('DEVICE_TIMEOUT', '响铃请求未确认，请刷新查询后再试')
  const item = meta({ id: nextId('find'), childId: c.childId, deviceId: c.deviceId, epoch: c.epoch, stage: 'ringing', startedAt: now(), endsAt: now() + 60000, endedAt: null, reason: '' })
  const db = database(); db.finds[c.childId] = item; save(db); return item
}
const mock = {
  __setClock(fn) { clock = fn || (() => Date.now()) },
  getContext: () => reply(() => context(), { local: true }),
  getParent: () => reply(() => { const s = actor(); return meta({ name: s.parentName, role: s.role, phone: s.phone, greeting: new Date(now()).getHours() < 12 ? '上午好' : '你好', avatar: '/assets/images/avatar.jpg' }) }),
  getChildren: () => reply(() => { actor(); return children() }),
  getGrowth: () => reply(() => growth(context())),
  getGrowthDimension: (key) => reply(() => { const c = context(), dim = growth(c).dimensions.find((d) => d.key === key); if (!dim) error('NOT_FOUND', '没有这项探索内容覆盖维度'); return Object.assign({}, dim, { child: c.child, childId: c.childId }) }),
  getReport: (id) => reply(() => { const c = context(), rid = id || 'w1'; if (store.getScenario() === 'generating' && !database().reports[c.childId + '.' + rid]) submit('report-regen', { id: rid }); return report(c, rid) }),
  regenerateReport: (id) => reply(() => submit('report-regen', { id: id || 'w1' })),
  getAchievement: (id) => reply(() => achievement(context(), id)),
  getFootprint: (id) => reply(() => { const c = context(), e = itemEvent(c, id, 'question'); const follows = store.getDemoData('follows.' + c.childId, {}); return meta(Object.assign(evidence(e), { child: c.child, type: '主动提问', scene: (lesson(e.courseId) || {}).title, summary: e.summary, concepts: e.concepts || [], follow: e.verificationText || '暂无进一步验证记录', followed: !!follows[e.id] })) }),
  toggleFootprintFollow: (id) => reply(() => { const c = context(); itemEvent(c, id, 'question'); const follows = store.getDemoData('follows.' + c.childId, {}); follows[id] = !follows[id]; store.setDemoData('follows.' + c.childId, follows); return { id, followed: follows[id] } }),
  getHome: () => reply(() => {
    const c = context(), g = growth(c), list = events(c), loc = currentLocation(c)
    const dynamics = list.slice().sort((a, b) => b.occurredAt - a.occurredAt).map((e) => Object.assign(evidence(e), { desc: e.summary || (lesson(e.courseId) || {}).module || '', time: stamp(e.occurredAt), tone: 'sky', icon: '/assets/icons/lucide/sparkles.png' }))
    const todos = []
    if (!c.child.deviceBound) todos.push({ id: 'bind', title: '设备尚未绑定', desc: '绑定后可恢复守护工具', url: '/pages/family/bind', tone: 'coral', action: '去绑定' })
    else if (!loc.online) todos.push({ id: 'offline', title: '设备离线', desc: '位置与通话暂不可用', url: '/pages/guard/index', tone: 'coral', action: '查看守护' })
    if (store.getInvites().u3 === 'pending' && c.canManage) todos.push({ id: 'invite', title: '家庭邀请待处理', desc: '有 1 位成员等待确认', url: '/pages/my/family', tone: 'butter', action: '去处理' })
    const footprints = list.filter((e) => e.type === 'question').map((e) => Object.assign(evidence(e), { tag: '主动提问', tagTone: 'sky', tone: 'sky', desc: e.summary }))
    const achievements = g.achievements.map((a) => Object.assign({}, a, { type: '探索成果', extra: '来自已保存的探索内容记录', tone: 'sky' }))
    return meta({ child: c.child, childId: c.childId, greeting: '你好', empty: list.length === 0, hero: { image: '/assets/island/ocean-world.jpg', title: '每一步探索，都有记录', subtitle: c.child.shortName + '已完成 ' + g.progress.completed + ' 项探索内容' }, summary: { dynamics: dynamics.length, onlineMinutes: 0, todos: todos.length, deviceOnline: loc.online, completed: g.progress.completed }, dynamics, todos, footprints, achievements, photos: achievements.map((a) => a.image), photoCard: achievements[0] ? { title: achievements[0].title, desc: '查看探索成果记录', time: achievements[0].time } : null, suggestion: list.length ? { title: '今日陪伴建议', text: '和' + c.child.shortName + '聊聊最近一次探索记录中的观察与理由。' } : null, guide: { title: '玩机指南', desc: '了解守护与探索记录', status: '查看指南' }, progress: g.progress })
  }),
  getLocation: () => reply(() => currentLocation(context())),
  refreshLocation: () => reply(() => { const c = context(); requireDevice(c, true); const db = database(); db.locations[c.childId] = { point: POINT, updatedAt: now() }; save(db); return Object.assign(currentLocation(c), { ok: true, message: '位置已更新' }) }),
  getContacts: () => reply(() => { const c = context(), ids = store.getSosIds(c.childId); return contacts(c).map((x) => Object.assign({}, x, { sos: ids.includes(x.id) })) }),
  getContact: (id) => reply(() => contacts(context()).find((x) => x.id === id) || null),
  saveContact: (p) => reply(() => submit('contact-sync', p)),
  getAlarms: () => reply(() => alarms(context())),
  getAlarm: (id) => reply(() => alarms(context()).find((x) => x.id === id) || null),
  getSos: () => reply(() => { const c = context(), list = contacts(c); return store.getSosIds(c.childId).map((id, index) => { const item = list.find((x) => x.id === id && x.deviceCall); return item ? Object.assign({}, item, { order: index + 1, synced: store.getDemoData('sosSynced.' + c.childId, true) }) : null }).filter(Boolean) }),
  saveSos: (ids) => reply(() => submit('sos-update', { ids })),
  getDevices: () => reply(() => { actor(); return children().filter((c) => c.deviceBound).map((c) => meta({ id: c.deviceId, childId: c.id, name: c.deviceName, childName: c.name, online: c.online, battery: c.battery, firmware: '1.4.2', locate: c.online ? '在线' : '离线', updatedAt: c.online ? '刚刚' : '暂无实时更新' })) }),
  getFamily: () => reply(() => {
    const c = context(), s = store.getSession(), invites = store.getInvites()
    const adminId = c.canManage ? 'u1' : store.getDemoData('adminMemberId', 'u2')
    const members = [
      { id: 'u1', name: s.parentName, role: s.role, relation: s.relation, status: '已加入' },
      { id: 'u2', name: '林屿', role: adminId === 'u2' ? '主管理员' : '普通成员', relation: '爸爸', status: '已加入' }
    ]
    if (invites.u3 !== 'rejected') members.push({ id: 'u3', name: '周屿', role: invites.u3 === 'pending' ? '待确认' : adminId === 'u3' ? '主管理员' : '普通成员', relation: '监护人', status: invites.u3 === 'pending' ? '邀请待处理' : '已加入', pending: invites.u3 === 'pending' })
    return meta({ name: s.familyName, admin: (members.find((x) => x.id === adminId) || {}).name, adminId, role: s.role, canManage: c.canManage, members, children: c.children })
  }),
  acceptInvite: (id) => reply(() => submit('invite-accept', { id })),
  rejectInvite: (id) => reply(() => submit('invite-reject', { id })),
  submitTask: (type, p) => reply(() => submit(type, p)),
  getTask: (id) => reply(() => { const t = store.getTasks()[id]; if (!t) return { id, status: 'unknown', message: '未找到任务，请检查当前账号' }; if (t.finalAfterRevocation && t.parentId === store.getSession().parentId) return t; const c = context(); if (t.parentId !== c.parentId || t.familyId !== c.familyId || (t.childId !== c.childId && t.type !== 'child-unbind')) error('TASK_FORBIDDEN', '这项任务不属于当前孩子'); return t }, { allowChanged: (task) => task.finalAfterRevocation || (task.type === 'child-unbind' && task.status === 'success') }),
  completeBind: (taskId) => reply(() => { const c = context(); const task = Object.values(store.getTasks()).find((t) => (!taskId || t.id === taskId) && t.type === 'child-bind' && t.status === 'success' && t.epoch === c.epoch && t.parentId === c.parentId); if (!task || !store.getSession().familyReady) error('BIND_NOT_COMPLETE', '绑定尚未成功，请继续查询'); store.setCurrentChildId(task.payload.bindChildId); return { ok: true, childId: task.payload.bindChildId } }, { allowChanged: true }),
  getPrivacyRequest: (type) => reply(() => { const c = context(); return database().requests[c.childId + '.' + type] || null }),
  getSubscription: () => reply(() => { actor(); return { enabled: !!store.getDemoData('subscriptionEnabled', false), isDemo: true } }),
  getFeedbacks: () => reply(() => { const c = context(); return database().feedbacks.filter((x) => x.childId === c.childId) }),
  getMessages: () => reply(() => {
    const c = context(), g = growth(c), reads = store.getReadMessageIds(c.childId), list = []
    if (store.getInvites().u3 === 'pending') list.push({ id: 'm1', type: '家庭', title: '家庭成员申请待处理', time: '待处理', url: '/pages/my/family', unread: true })
    if (c.child.battery < 20 && c.child.deviceBound) list.push({ id: 'm2', type: '守护', title: c.child.deviceName + ' 电量低于 20%', time: '当前', url: '/pages/my/device', unread: true })
    g.reports.forEach((r) => list.push({ id: 'report-' + r.id, type: '成长', title: r.title + (r.status === 'ready' ? '可查看' : '正在生成'), time: r.range, unread: true, url: (r.type === 'phase' ? '/pages/growth/phase?id=' : '/pages/growth/weekly?id=') + r.id }))
    return list.map((x) => meta(Object.assign({}, x, { childId: c.childId, unread: x.unread && !reads.includes(x.id) })))
  }),
  markMessageRead: (id) => reply(() => { const c = context(); store.markMessageRead(id, c.childId); return { ok: true } }),
  getGuide: () => reply(() => { const c = context(); return [{ id: 'g1', title: '绑定 Mini 设备', status: c.child.deviceBound ? '已完成' : '待绑定', desc: '使用已提供的绑定码建立关系', url: '/pages/family/bind' }, { id: 'g2', title: '实时守护', status: '查看', desc: '只显示当前有效位置', url: '/pages/guard/index' }, { id: 'g3', title: '语音通话', status: '查看', desc: '在线设备可发起通话', url: '/pages/guard/call' }, { id: 'g4', title: '联系人与紧急联系人', status: '查看', desc: '离线配置保存后待同步', url: '/pages/guard/contacts' }, { id: 'g5', title: '查找设备', status: '查看', desc: '响铃最多 60 秒，可随时停止', url: '/pages/guard/find' }] }),
  getSharePreview: (target) => reply(() => {
    const c = context()
    const q = typeof target === 'object' && target ? target : { targetType: 'report', targetId: target || 'w1' }
    if (q.childId && q.childId !== c.childId) error('SHARE_FORBIDDEN', '请切回这份内容所属的孩子后再分享')
    const type = q.targetType || 'report', id = q.targetId || q.id || 'w1'
    if (!['report', 'achievement'].includes(type)) error('INVALID_SHARE', '不支持分享这类内容')
    const item = type === 'achievement' ? achievement(c, id) : report(c, id)
    const canShare = type === 'achievement' || item.status === 'ready'
    const alias = c.child.shortName === c.child.name ? '孩子' : c.child.shortName
    const redact = (value) => {
      let text = String(value || '')
      database().children.forEach((child) => {
        text = text.split(child.name).join('孩子').split(child.deviceId).join('[设备]').split(child.deviceName).join('[设备]')
      })
      const familyName = store.getSession().familyName
      if (familyName) text = text.split(familyName).join('[家庭]')
      return text.replace(/1[3-9]\d{9}/g, '[手机号]').replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, '[时刻]').replace(/\b\d{2,3}\.\d{4,}\b/g, '[坐标]')
    }
    return meta({ id, targetId: id, targetType: type, childId: c.childId, title: redact(item.title) + '（脱敏）', childAlias: alias, range: item.range || item.date, body: redact(type === 'achievement' ? item.process : item.sections.map((s) => s.title + '：' + s.body).join('\n')), hidden: ['全名', '位置', '设备 ID', '家庭信息', '精确时刻'], generating: item.status === 'generating', canShare, status: item.status || 'ready' })
  }),
  getCallSession: () => reply(() => callSession(context())),
  startCall: () => reply(startCall),
  updateCallControl: (control, value) => reply(() => { const c = context(), session = callSession(c); if (!['muted', 'speaker', 'nr'].includes(control)) error('INVALID_CONTROL', '不支持的通话控制'); if (!session || session.stage !== 'connected') error('CALL_NOT_CONNECTED', '通话尚未接通'); session[control] = !!value; const db = database(); db.calls[c.childId] = session; save(db); return session }),
  endCall: (reason) => reply(() => { const c = context(), session = callSession(c); if (!session || !['calling', 'connected'].includes(session.stage)) return session; session.stage = 'ended'; session.endedAt = now(); session.reason = reason || '已主动挂断'; const db = database(); db.calls[c.childId] = session; save(db); return session }),
  getFindSession: () => reply(() => findSession(context())),
  startFinding: () => reply(startFinding),
  stopFinding: (reason) => reply(() => { const c = context(), session = findSession(c); if (!session || session.stage !== 'ringing') return session; session.stage = 'stopped'; session.endedAt = now(); session.reason = reason || '已手动停止'; const db = database(); db.finds[c.childId] = session; save(db); return session }),
  setDemoScenario: (name) => reply(() => { actor(); if (!SCENARIOS.includes(name)) error('INVALID_SCENARIO', '未知测试场景'); store.setScenario(name); if (name === 'stale' || name === 'device-online') { const db = database(); if (name === 'stale') delete db.locations[store.getCurrentChildId()]; else db.children.find((x) => x.id === store.getCurrentChildId()).online = true; save(db) }; if (name === 'generating' && events(context()).length) { submit('report-regen', { id: 'w1' }); submit('report-regen', { id: 'p1' }) }; return context() }, { local: true }),
  resetDemo: () => reply(() => { actor(); store.resetDemoData(); return context() }, { local: true, allowChanged: true }),
  injectDemoEvent: (payload) => reply(() => {
    const c = context(), p = clone(payload || {}), db = database()
    if (p.childId && p.childId !== c.childId) error('EVENT_FORBIDDEN', '只能为当前孩子添加测试记录')
    const type = p.type || 'course-completed', courseId = p.courseId || ((p.webLevelId || '').replace(/^demo-level-/, ''))
    if (!['course-completed', 'course-unlocked', 'question', 'achievement'].includes(type)) error('INVALID_EVENT', '不支持的学习事件')
    if (!plan(c).some((x) => x.id === courseId)) error('COURSE_NOT_IN_PLAN', '探索内容不属于当前孩子的固定探索内容目录')
    const rows = db.events[c.childId] || [], duplicate = rows.find((e) => (p.id && e.id === p.id) || (type === 'course-completed' && e.type === type && e.courseId === courseId))
    if (duplicate) return { event: duplicate, duplicate: true }
    if (type === 'question' && !String(p.title || '').trim()) error('INVALID_EVENT', '请提供问题内容')
    const occurredAt = p.occurredAt == null ? now() : Number(p.occurredAt)
    if (!Number.isFinite(occurredAt) || occurredAt > now()) error('INVALID_EVENT_TIME', '事件时间不正确')
    const id = p.id || 'event-' + now() + '-' + (db.sequence + 1); db.sequence += 1
    const e = meta({ id, childId: c.childId, type, courseId, occurredAt, source: '本地探索记录', title: String(p.title || '').trim(), summary: String(p.summary || ''), concepts: Array.isArray(p.concepts) ? p.concepts : [], verified: !!p.verified, verificationText: p.verified ? String(p.verificationText || '') : '', followups: Math.max(0, Number(p.followups) || 0), webLevelId: 'demo-level-' + courseId })
    db.events[c.childId] = rows.concat(e); save(db); return { event: e, duplicate: false }
  })
}
module.exports = mock
