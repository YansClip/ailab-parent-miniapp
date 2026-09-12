const KEY = 'ailab.session.v1'
const CHILD_KEY = 'ailab.currentChildId'
const SCENARIO_KEY = 'ailab.mock.scenario'
const TASK_KEY = 'ailab.tasks'
const FOLLOW_KEY = 'ailab.follows'
const DATA_KEY = 'ailab.demo.data'
const DATA_VERSION_KEY = 'ailab.local.version'
const DATA_VERSION = 3
const EPOCH_KEY = 'ailab.session.epoch'

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v === undefined ? fallback : v
  } catch (e) {
    return fallback
  }
}

function write(key, value) {
  wx.setStorageSync(key, value)
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

const listeners = []

function emit(type, payload) {
  listeners.slice().forEach((fn) => {
    try {
      fn(type, payload)
    } catch (e) {
      console.warn('[AILab store] listener failed:', type, e && e.message ? e.message : e)
    }
  })
}

const SOS_KEY = 'ailab.sosIds'
const INVITE_KEY = 'ailab.invites'

function defaultSession() {
  return {
    privacyAccepted: false,
    loggedIn: false,
    familyCreated: false,
    familyReady: false,
    familyName: '林小满的家庭',
    relation: '妈妈',
    parentName: '陈然',
    role: '主管理员',
    phone: '138****2160',
    parentId: 'parent-chenran',
    familyId: 'family-demo'
  }
}

const store = {
  init() {
    const version = Number(read(DATA_VERSION_KEY, 0))
    if (version < 2) {
      const legacySos = read(SOS_KEY, ['c1', 'c2'])
      if (Array.isArray(legacySos)) write(SOS_KEY, { 'child-xiaoman': legacySos })
    }
    if (version < 3) {
      const legacyData = asRecord(read(DATA_KEY, {}))
      if (Object.prototype.hasOwnProperty.call(legacyData, 'contacts') && !Object.prototype.hasOwnProperty.call(legacyData, 'contacts.child-xiaoman')) {
        legacyData['contacts.child-xiaoman'] = legacyData.contacts
        delete legacyData.contacts
      }
      if (Object.prototype.hasOwnProperty.call(legacyData, 'alarms') && !Object.prototype.hasOwnProperty.call(legacyData, 'alarms.child-xiaoman')) {
        legacyData['alarms.child-xiaoman'] = legacyData.alarms
        delete legacyData.alarms
      }
      write(DATA_KEY, legacyData)
    }
    write(DATA_VERSION_KEY, DATA_VERSION)
    const session = Object.assign(defaultSession(), read(KEY, {}))
    write(KEY, session)
    const legacyTasks = asRecord(read(TASK_KEY, {}))
    let tasksChanged = false
    Object.keys(legacyTasks).forEach((id) => {
      const task = legacyTasks[id]
      if (task && !task.epoch && ['submitted', 'executing', 'timeout'].indexOf(task.status) >= 0) {
        legacyTasks[id] = Object.assign({}, task, { status: 'cancelled', message: '旧版待处理操作已取消，请重新提交' })
        tasksChanged = true
      }
    })
    if (tasksChanged) write(TASK_KEY, legacyTasks)
    if (!read(CHILD_KEY, '')) write(CHILD_KEY, 'child-xiaoman')
  },

  getSession() {
    return Object.assign(defaultSession(), read(KEY, {}))
  },

  setSession(patch) {
    const next = Object.assign(this.getSession(), patch)
    write(KEY, next)
    emit('session', next)
    return next
  },

  getCurrentChildId() {
    return read(CHILD_KEY, 'child-xiaoman')
  },

  getEpoch() { return Number(read(EPOCH_KEY, 1)) || 1 },
  bumpEpoch() { const next = this.getEpoch() + 1; write(EPOCH_KEY, next); return next },

  setCurrentChildId(id) {
    const previousId = this.getCurrentChildId()
    if (!id || id === previousId) return previousId
    emit('clear', { previousId, nextId: id })
    write(CHILD_KEY, id)
    emit('child', { id, previousId })
    return id
  },

  getScenario() {
    return read(SCENARIO_KEY, 'default')
  },

  setScenario(name) {
    write(SCENARIO_KEY, name)
    emit('scenario', name)
  },

  getTasks() {
    return asRecord(read(TASK_KEY, {}))
  },

  setTask(id, task) {
    const all = this.getTasks()
    all[id] = task
    write(TASK_KEY, all)
    emit('task', task)
  },

  getFollows() {
    return asRecord(read(FOLLOW_KEY, {}))
  },

  getDemoData(key, fallback) {
    const all = asRecord(read(DATA_KEY, {}))
    if (!Object.prototype.hasOwnProperty.call(all, key)) return fallback
    return all[key]
  },

  setDemoData(key, value) {
    const all = asRecord(read(DATA_KEY, {}))
    all[key] = value
    write(DATA_KEY, all)
    emit('demo-data', { key, value })
    return value
  },

  toggleFollow(id) {
    const all = this.getFollows()
    all[id] = !all[id]
    write(FOLLOW_KEY, all)
    return all[id]
  },

  on(fn) {
    listeners.push(fn)
    return () => {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  },

  getSosIds(childId) {
    const value = read(SOS_KEY, {})
    if (Array.isArray(value)) return value
    return asRecord(value)[childId || this.getCurrentChildId()] || ['c1', 'c2']
  },

  setSosIds(ids, childId) {
    const value = read(SOS_KEY, {})
    const all = Array.isArray(value) ? { 'child-xiaoman': value } : asRecord(value)
    all[childId || this.getCurrentChildId()] = ids
    write(SOS_KEY, all)
    emit('sos', ids)
    return ids
  },

  getReadMessageIds(childId) {
    const all = asRecord(this.getDemoData('messageReads', {}))
    const ids = all[childId || this.getCurrentChildId()]
    return Array.isArray(ids) ? ids : []
  },

  markMessageRead(id, selectedChildId) {
    const all = asRecord(this.getDemoData('messageReads', {}))
    const childId = selectedChildId || this.getCurrentChildId()
    const ids = all[childId] || []
    if (ids.indexOf(id) < 0) all[childId] = ids.concat(id)
    this.setDemoData('messageReads', all)
    return all[childId] || ids
  },

  getInvites() {
    return Object.assign({ u3: 'pending' }, asRecord(read(INVITE_KEY, {})))
  },

  setInvite(id, status) {
    const all = this.getInvites()
    all[id] = status
    write(INVITE_KEY, all)
    emit('invite', all)
    return all
  },

  logout() {
    this.bumpEpoch()
    write(KEY, defaultSession())
    write(CHILD_KEY, 'child-xiaoman')
    write(TASK_KEY, {})
    write(FOLLOW_KEY, {})
    write(SOS_KEY, { 'child-xiaoman': ['c1', 'c2'] })
    write(INVITE_KEY, { u3: 'pending' })
    write(DATA_KEY, {})
    write(DATA_VERSION_KEY, DATA_VERSION)
    write(SCENARIO_KEY, 'default')
    emit('logout', {})
  },

  resetDemoData() {
    const previous = this.getSession()
    const authenticated = previous.loggedIn === true && previous.privacyAccepted === true
    // Restore the seeded family without granting login or privacy consent.
    const session = Object.assign(defaultSession(), {
      loggedIn: previous.loggedIn === true,
      privacyAccepted: previous.privacyAccepted === true,
      familyCreated: authenticated,
      familyReady: authenticated
    })
    this.bumpEpoch()
    write(KEY, session)
    write(CHILD_KEY, 'child-xiaoman')
    write(SCENARIO_KEY, 'default')
    write(TASK_KEY, {})
    write(FOLLOW_KEY, {})
    write(SOS_KEY, { 'child-xiaoman': ['c1', 'c2'] })
    write(INVITE_KEY, { u3: 'pending' })
    write(DATA_KEY, {})
    write(DATA_VERSION_KEY, DATA_VERSION)
    emit('reset', { childId: 'child-xiaoman' })
  },

  clearSensitive(nextId) {
    emit('clear', { previousId: this.getCurrentChildId(), nextId: nextId || '' })
  }
}

module.exports = store
