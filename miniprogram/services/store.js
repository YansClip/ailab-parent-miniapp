const KEY = 'ailab.session.v1'
const CHILD_KEY = 'ailab.currentChildId'
const SCENARIO_KEY = 'ailab.mock.scenario'
const TASK_KEY = 'ailab.tasks'
const FOLLOW_KEY = 'ailab.follows'
const DATA_KEY = 'ailab.demo.data'

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
    phone: '138****2160'
  }
}

const store = {
  init() {
    const session = Object.assign(defaultSession(), read(KEY, {}))
    write(KEY, session)
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
    return read(TASK_KEY, {})
  },

  setTask(id, task) {
    const all = this.getTasks()
    all[id] = task
    write(TASK_KEY, all)
    emit('task', task)
  },

  getFollows() {
    return read(FOLLOW_KEY, {})
  },

  getDemoData(key, fallback) {
    const all = read(DATA_KEY, {})
    if (!Object.prototype.hasOwnProperty.call(all, key)) return fallback
    return all[key]
  },

  setDemoData(key, value) {
    const all = read(DATA_KEY, {})
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

  getSosIds() {
    return read(SOS_KEY, ['c1', 'c2'])
  },

  setSosIds(ids) {
    write(SOS_KEY, ids)
    emit('sos', ids)
    return ids
  },

  getInvites() {
    return read(INVITE_KEY, { u3: 'pending' })
  },

  setInvite(id, status) {
    const all = this.getInvites()
    all[id] = status
    write(INVITE_KEY, all)
    emit('invite', all)
    return all
  },

  logout() {
    write(KEY, defaultSession())
    write(CHILD_KEY, 'child-xiaoman')
    write(TASK_KEY, {})
    write(FOLLOW_KEY, {})
    write(SOS_KEY, ['c1', 'c2'])
    write(INVITE_KEY, { u3: 'pending' })
    write(DATA_KEY, {})
  },

  clearSensitive(nextId) {
    emit('clear', { previousId: this.getCurrentChildId(), nextId: nextId || '' })
  }
}

module.exports = store
