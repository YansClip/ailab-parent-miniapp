const store = require('./store')
let taskSequence = 0

function delay(ms) {
  const scenario = store.getScenario()
  if (scenario === 'loading') ms = Math.max(ms, 1200)
  if (scenario === 'offline') {
    return Promise.reject({ code: 'OFFLINE', message: '网络不可用，请检查后重试' })
  }
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function wrap(data, ms) {
  return delay(ms || 240).then(() => JSON.parse(JSON.stringify(data)))
}

const CHILDREN = [
  {
    id: 'child-xiaoman',
    name: '林小满',
    shortName: '小满',
    avatarText: '满',
    days: 126,
    deviceId: 'dev-mini-01',
    deviceName: 'Mini 01',
    online: true,
    battery: 68,
    avatarColor: '#8b78e6'
  },
  {
    id: 'child-xinghe',
    name: '陈星河',
    shortName: '星河',
    avatarText: '河',
    days: 41,
    deviceId: 'dev-mini-02',
    deviceName: 'Mini 02',
    online: false,
    battery: 18,
    avatarColor: '#40b352'
  }
]

const SCIENCE_CENTER = {
  latitude: 23.0597,
  longitude: 113.3640,
  name: '广州市番禺区 · 广东科学中心附近',
  accuracy: 18
}

const DEFAULT_CONTACTS = [
  { id: 'c1', name: '陈然', relation: '妈妈', phone: '138****2160', deviceCall: true },
  { id: 'c2', name: '林屿', relation: '爸爸', phone: '139****8801', deviceCall: true },
  { id: 'c3', name: '周老师', relation: '班主任', phone: '137****4412', deviceCall: false }
]

const DEFAULT_ALARMS = [
  { id: 'al1', time: '07:20', label: '起床', repeat: '周一至周五', enabled: true, synced: true },
  { id: 'al2', time: '21:00', label: '晚安', repeat: '每天', enabled: true, synced: true }
]

function contactsData() {
  return store.getDemoData('contacts.' + currentChild().id, DEFAULT_CONTACTS).map((item) => Object.assign({}, item))
}

function alarmsData() {
  return store.getDemoData('alarms.' + currentChild().id, DEFAULT_ALARMS).map((item) => Object.assign({}, item))
}

function activeChildren() {
  const hidden = store.getDemoData('unboundChildren', [])
  return CHILDREN.filter((item) => hidden.indexOf(item.id) < 0)
}

function isDeviceBound(child) {
  return store.getDemoData('unboundDevices', []).indexOf(child.deviceId) < 0
}

function applyTaskMutation(type, payload) {
  if (type === 'contact-sync') {
    const list = contactsData()
    const next = {
      id: payload.id || 'c' + Date.now(),
      name: payload.name,
      relation: payload.relation,
      phone: payload.phone,
      deviceCall: !!payload.deviceCall
    }
    const index = list.findIndex((item) => item.id === next.id)
    if (index >= 0) list[index] = next
    else list.push(next)
    store.setDemoData('contacts.' + currentChild().id, list)
  }
  if (type === 'contact-delete') {
    store.setDemoData('contacts.' + currentChild().id, contactsData().filter((item) => item.id !== payload.id))
  }
  if (type === 'alarm-save') {
    const list = alarmsData()
    const next = {
      id: payload.id || 'al' + Date.now(),
      time: payload.time,
      label: payload.label,
      repeat: payload.repeat || '仅一次',
      enabled: !!payload.enabled,
      synced: true
    }
    const index = list.findIndex((item) => item.id === next.id)
    if (index >= 0) list[index] = next
    else list.push(next)
    store.setDemoData('alarms.' + currentChild().id, list)
  }
  if (type === 'alarm-delete') {
    store.setDemoData('alarms.' + currentChild().id, alarmsData().filter((item) => item.id !== payload.id))
  }
  if (type === 'admin-transfer') {
    store.setSession({ role: '普通成员' })
  }
  if (type === 'invite-accept') store.setInvite(payload.id, 'accepted')
  if (type === 'invite-reject') store.setInvite(payload.id, 'rejected')
  if (type === 'sos-update') store.setSosIds((payload.ids || []).slice(0, 3))
  if (type === 'device-unbind') {
    const ids = store.getDemoData('unboundDevices', [])
    if (ids.indexOf(payload.id) < 0) store.setDemoData('unboundDevices', ids.concat(payload.id))
  }
  if (type === 'child-unbind') {
    const ids = store.getDemoData('unboundChildren', [])
    const next = ids.indexOf(payload.id) < 0 ? ids.concat(payload.id) : ids
    store.setDemoData('unboundChildren', next)
    const remaining = CHILDREN.filter((item) => next.indexOf(item.id) < 0)
    if (store.getCurrentChildId() === payload.id && remaining[0]) store.setCurrentChildId(remaining[0].id)
  }
  if (type === 'subscription-update') store.setDemoData('subscriptionEnabled', !!payload.enabled)
  if (['child-data-request', 'data-delete', 'consent-withdraw', 'account-cancel'].indexOf(type) >= 0) {
    store.setDemoData('privacyRequests.' + type, {
      type,
      status: 'accepted',
      requestedAt: Date.now(),
      message: taskMessage(type, 'success')
    })
  }
}

function taskMessage(type, status) {
  const deviceTypes = ['voice-call', 'find-device', 'find-stop', 'contact-sync', 'contact-delete', 'alarm-save', 'alarm-delete', 'sos-update', 'device-unbind']
  const success = {
    'family-create': '家庭已创建',
    'child-bind': '绑定申请已提交',
    'admin-transfer': '管理员身份已转移',
    'invite-accept': '已同意加入家庭',
    'invite-reject': '已拒绝本次邀请',
    'child-unbind': '孩子关系已解除',
    'voice-call': '语音连接已建立',
    'find-device': '设备已开始响铃',
    'find-stop': '设备响铃已停止',
    'contact-sync': '联系人已同步',
    'contact-delete': '联系人已删除',
    'alarm-save': '闹钟已同步',
    'alarm-delete': '闹钟已删除',
    'sos-update': '紧急联系人已同步',
    'device-unbind': '设备已解绑',
    'report-regen': '成长报告已重新生成',
    'subscription-update': '提醒设置已保存',
    'feedback': '反馈已提交',
    'child-data-request': '儿童信息申请已受理',
    'data-delete': '数据删除申请已受理',
    'consent-withdraw': '撤回同意申请已受理',
    'account-cancel': '账号注销申请已受理'
  }
  if (status === 'submitted') return '请求已提交'
  if (status === 'executing') return deviceTypes.indexOf(type) >= 0 ? 'Mini 设备正在处理' : '正在处理申请'
  if (status === 'failed') return '处理失败，当前信息未发生变化'
  if (status === 'timeout') return '等待超时，可稍后查询最终结果'
  return success[type] || '处理已完成'
}

function currentChild() {
  const id = store.getCurrentChildId()
  const list = activeChildren()
  return list.find((c) => c.id === id) || list[0] || CHILDREN[0]
}

function greeting() {
  const h = new Date().getHours()
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

const mock = {
  getParent() {
    const s = store.getSession()
    return wrap({
      name: s.parentName,
      role: s.role,
      phone: s.phone,
      greeting: greeting(),
      avatar: '/assets/images/avatar.jpg'
    })
  },

  getChildren() {
    return wrap(activeChildren())
  },

  getHome() {
    const scenario = store.getScenario()
    const child = currentChild()
    const deviceBound = isDeviceBound(child)
    const deviceOnline = deviceBound && child.online
    if (scenario === 'empty') {
      return wrap({
        child,
        greeting: greeting(),
        empty: true,
        hero: {
          image: '/assets/illustrations/home-hero-v2.jpg',
          title: '陪伴，从今天开始记录',
          subtitle: '绑定 Mini 设备后即可查看实时状态与成长内容'
        },
        summary: { dynamics: 0, onlineMinutes: 0, todos: 0, deviceOnline },
        dynamics: [],
        photos: [],
        footprints: [],
        achievements: [],
        suggestion: null,
        todos: [],
        guide: { title: '玩机指南', desc: '3 分钟了解守护与设备工具', status: '未开始' }
      }, 300)
    }
    const isXinghe = child.id === 'child-xinghe'
    return wrap({
      child,
      greeting: greeting(),
      empty: false,
      hero: {
        image: '/assets/illustrations/home-hero-v2.jpg',
        title: '今天，也在好好长大',
        subtitle: !deviceBound ? '尚未绑定设备 · 陪伴记录仍可查看' : isXinghe ? '设备当前离线 · 成长记录仍可查看' : '新增 3 条陪伴动态 · 1 项待处理'
      },
      summary: {
        dynamics: isXinghe ? 1 : 3,
        onlineMinutes: isXinghe ? 0 : 26,
        todos: isXinghe ? 1 : 1,
        deviceOnline
      },
      photos: isXinghe ? [] : [
        '/assets/illustrations/result-sound-v2.jpg',
        '/assets/illustrations/result-robot-arm-v2.jpg',
        '/assets/illustrations/result-rocket-v2.jpg'
      ],
      photoCard: isXinghe ? null : {
        title: '声波实验被 Mini 拍下了',
        time: '17:28',
        desc: '小满完成波形挑战后，设备自动生成了这条陪伴记录。'
      },
      dynamics: !deviceBound
        ? [
            { id: 'd-unbound', icon: '/assets/icons/lucide/device.png', title: 'Mini 设备已解绑', desc: '守护工具暂不可用，可前往设备中心重新绑定', time: '刚刚', tone: 'coral' }
          ]
        : isXinghe
        ? [
            { id: 'd4', icon: '/assets/icons/lucide/device.png', title: 'Mini 02 已离线', desc: '守护工具暂不可用', time: '12:08', tone: 'coral' }
          ]
        : [
            { id: 'd1', icon: '/assets/icons/lucide/sparkles.png', title: '完成声音波形挑战', desc: '记录了一次细致观察与主动表达', time: '17:28', tone: 'lavender' },
            { id: 'd2', icon: '/assets/icons/lucide/online.png', title: 'Mini 01 已恢复在线', desc: '位置与电量状态已更新', time: '16:55', tone: 'mint' },
            { id: 'd3', icon: '/assets/icons/lucide/invite.png', title: '家庭邀请待处理', desc: '周屿申请成为普通监护人', time: '15:40', tone: 'butter' }
          ],
      footprints: [
        { id: 'fp1', date: '8 月 25 日', tag: '提出一个好问题', tagTone: 'lavender', title: '为什么火箭能在太空中改变方向？', desc: '从推进器演示开始，连续追问了 3 次', tone: 'lavender' },
        { id: 'fp2', date: '8 月 24 日', tag: '发现一个新词', tagTone: 'butter', title: 'orbit / 轨道', desc: '用自己的话解释了“绕着转”的含义', tone: 'butter' },
        { id: 'fp3', date: '8 月 23 日', tag: '完成一次观点表达', tagTone: 'mint', title: '我认为机器人也需要先观察再行动', desc: '形成了完整的理由与例子', tone: 'mint' }
      ],
      achievements: [
        { id: 'a1', type: '互动成果', title: '声音波形挑战', extra: '细心观察并完成波形对照', tone: 'lavender', image: '/assets/illustrations/result-sound-v2.jpg' },
        { id: 'a2', type: '项目成果', title: '机械臂协作项目', extra: '清楚表达了自己的操作思路', tone: 'mint', image: '/assets/illustrations/result-robot-arm-v2.jpg' }
      ],
      suggestion: {
        title: '今日陪伴建议',
        text: '请小满说说“为什么这样判断”，帮助表达与逻辑同步成长。'
      },
      todos: (function () {
        const list = []
        if (!deviceBound) {
          list.push({ id: 't-bind', title: '设备未绑定', desc: '当前孩子尚未绑定 Mini 设备', action: '前往设备中心 →', tone: 'coral', url: '/pages/my/device' })
        } else if (!child.online) {
          list.push({ id: 't-off', title: '设备离线', desc: child.deviceName + ' 暂无实时位置', action: '查看守护', tone: 'coral', url: '/pages/guard/index' })
        } else if (child.battery < 20) {
          list.push({ id: 't-bat', title: '电量较低', desc: child.deviceName + ' 剩余 ' + child.battery + '%', action: '今晚充电 →', tone: 'butter', url: '/pages/my/device' })
        }
        if (store.getInvites().u3 === 'pending') {
          list.push({ id: 't2', title: '家庭邀请', desc: '1 项等待处理', action: '立即处理 →', tone: 'coral', url: '/pages/my/family' })
        }
        if (!list.length) {
          list.push({ id: 't-ok', title: '设备状态正常', desc: child.deviceName + ' 电量 ' + child.battery + '%', action: '查看设备 →', tone: 'butter', url: '/pages/my/device' })
        }
        return list
      })(),
      guide: { title: '玩机指南', desc: '3 分钟了解守护与设备工具', status: '开始查看' }
    })
  },

  getFootprint(id) {
    const map = {
      fp1: {
        id: 'fp1',
        date: '2026 年 8 月 25 日',
        type: '主动发问',
        title: '为什么火箭能在太空中改变方向？',
        scene: '推进器互动实验',
        summary: '小满从推进器火焰方向开始提问，并连续追问了三次：燃料用完怎么办、没有空气怎么推、转向会不会把自己推偏。',
        concepts: ['反作用力', '矢量', '推进'],
        follow: '随后用积木模拟了“喷气方向改变运动方向”。',
        source: '互动探索 · 记录于 8 月 25 日'
      },
      fp2: {
        id: 'fp2',
        date: '2026 年 8 月 24 日',
        type: '概念发现',
        title: 'orbit / 轨道',
        scene: '行星运动主题探索',
        summary: '小满第一次使用“轨道”这个词，并用“绕着转、不会掉下去”解释自己的理解。',
        concepts: ['轨道', '圆周运动'],
        follow: '把轨道画成一条闭合的线，而不是直线冲出去。',
        source: '项目实践 · 记录于 8 月 24 日'
      },
      fp3: {
        id: 'fp3',
        date: '2026 年 8 月 23 日',
        type: '观点表达',
        title: '我认为机器人也需要先观察再行动',
        scene: '机械臂协作项目',
        summary: '小满提出：如果机械臂不先看看周围，就容易撞到积木。她用两次对比实验说明理由。',
        concepts: ['观察', '安全', '计划'],
        follow: '在操作中加入了“先扫描再抓取”的步骤。',
        source: '项目成果 · 记录于 8 月 23 日'
      }
    }
    const item = map[id] || map.fp1
    item.followed = !!store.getFollows()[item.id]
    return wrap(item)
  },

  getLocation() {
    const scenario = store.getScenario()
    const child = currentChild()
    if (!isDeviceBound(child)) {
      return wrap({
        child,
        status: 'unbound',
        point: null,
        label: '尚未绑定设备',
        hint: '绑定 Mini 设备后才能查看当前实时位置和使用守护工具。',
        updatedAt: null,
        battery: null,
        online: false
      })
    }
    if (scenario === 'offline' || !child.online) {
      return wrap({
        child,
        status: 'offline',
        point: null,
        label: '设备离线',
        hint: '离线时不展示位置点。可在设备恢复后刷新。',
        updatedAt: Date.now() - 36 * 60 * 1000,
        battery: child.battery,
        online: false
      })
    }
    if (scenario === 'stale') {
      return wrap({
        child,
        status: 'stale',
        point: null,
        label: '位置已过期',
        hint: '超过有效期后已清除坐标，请重新刷新。',
        updatedAt: Date.now() - 20 * 60 * 1000,
        battery: child.battery,
        online: true
      })
    }
    return wrap({
      child,
      status: 'valid',
      point: SCIENCE_CENTER,
      label: SCIENCE_CENTER.name,
      hint: '仅显示当前实时位置，不保存历史轨迹',
      updatedAt: Date.now() - 20 * 1000,
      accuracy: SCIENCE_CENTER.accuracy,
      battery: child.battery,
      online: true,
      nextAlarm: '07:20',
      sosCount: store.getSosIds().length,
    })
  },

  refreshLocation() {
    const child = currentChild()
    if (!isDeviceBound(child)) {
      return wrap({ ok: false, message: '尚未绑定设备，无法刷新位置' }, 400)
    }
    if (!child.online) {
      return wrap({ ok: false, message: '设备离线，无法刷新位置' }, 400)
    }
    return wrap({
      ok: true,
      status: 'valid',
      point: SCIENCE_CENTER,
      updatedAt: Date.now(),
      message: '位置已更新'
    }, 800)
  },

  getContacts() {
    const sos = store.getSosIds()
    return wrap(contactsData().map((item) => Object.assign({}, item, { sos: sos.indexOf(item.id) >= 0 })))
  },

  getContact(id) {
    return this.getContacts().then((list) => list.find((c) => c.id === id) || null)
  },

  saveContact(payload) {
    return this.submitTask('contact-sync', payload)
  },

  getAlarms() {
    return wrap(alarmsData())
  },

  getAlarm(id) {
    return this.getAlarms().then((list) => list.find((a) => a.id === id) || null)
  },

  getSos() {
    return this.getContacts().then((list) => {
      const ids = store.getSosIds()
      return ids.map((id, i) => {
        const c = list.find((x) => x.id === id)
        return c ? { id: c.id, name: c.name, relation: c.relation, order: i + 1 } : null
      }).filter(Boolean)
    })
  },

  saveSos(ids) {
    const next = (ids || []).slice(0, 3)
    return this.submitTask('sos-update', { ids: next })
  },

  getGrowth() {
    const scenario = store.getScenario()
    const child = currentChild()
    if (scenario === 'empty') {
      return wrap({
        child,
        empty: true,
        insight: null,
        brief: { status: 'insufficient', reason: '今日缺少代表性提问与主动验证事件' },
        dimensions: [],
        reports: [],
        achievements: [],
        timeline: []
      })
    }
    const isXinghe = child.id === 'child-xinghe'
    if (isXinghe) {
      return wrap({
        child,
        empty: false,
        insight: {
          range: '本周 8/18 – 8/25',
          change: '可观察事件较少，暂不形成能力结论',
          achievements: 0,
          activity: '低',
          questions: 2
        },
        brief: {
          status: 'insufficient',
          reason: '本周缺少代表性提问与主动验证，不生成虚构简报。'
        },
        dimensions: [
          { key: 'observe', name: '观察', insufficient: true },
          { key: 'express', name: '表达', insufficient: true },
          { key: 'collab', name: '协作', insufficient: true },
          { key: 'explore', name: '探究', insufficient: true },
          { key: 'create', name: '创造', insufficient: true },
          { key: 'persist', name: '坚持', insufficient: true }
        ],
        reports: [],
        achievements: [],
        timeline: []
      })
    }
    return wrap({
      child,
      empty: false,
      insight: {
        range: '本周 8/18 – 8/25',
        change: '观察与表达更稳定',
        achievements: 4,
        activity: '高',
        questions: 11
      },
      brief: {
        status: 'ready',
        date: '8 月 25 日',
        question: '为什么火箭能在太空中改变方向？',
        followups: 3,
        concepts: ['反作用力', '矢量'],
        verified: true,
        tip: '可以请孩子用自己的话再讲一遍推进方向。'
      },
      dimensions: [
        { key: 'observe', name: '观察', value: 82, delta: +8 },
        { key: 'express', name: '表达', value: 76, delta: +6 },
        { key: 'collab', name: '协作', value: 71, delta: +4 },
        { key: 'explore', name: '探究', value: 88, delta: +5 },
        { key: 'create', name: '创造', insufficient: true },
        { key: 'persist', name: '坚持', value: 74, delta: +2 }
      ],
      reports: [
        { id: 'w1', type: 'weekly', title: '成长周报', range: '8/18 – 8/25', status: 'ready' },
        { id: 'p1', type: 'phase', title: '阶段成长报告', range: '机械与运动主题', status: 'ready' }
      ],
      achievements: [
        { id: 'a1', title: '声音波形挑战', time: '8 月 25 日', source: '互动探索', image: '/assets/illustrations/result-sound-v2.jpg' },
        { id: 'a2', title: '机械臂协作项目', time: '8 月 23 日', source: '项目实践', image: '/assets/illustrations/result-robot-arm-v2.jpg' }
      ],
      timeline: [
        { id: 'tl1', title: '本周：连续追问推进方向', time: '8 月 25 日' },
        { id: 'tl2', title: '上周：首次独立解释轨道', time: '8 月 18 日' }
      ]
    })
  },

  getReport(id) {
    const generating = store.getScenario() === 'generating'
    const failed = store.getScenario() === 'fail'
    if (generating) {
      return wrap({ id, status: 'generating', title: '正在生成报告', range: '8/18 – 8/25' }, 200)
    }
    if (failed) {
      return wrap({ id, status: 'failed', title: '生成失败', range: '8/18 – 8/25', message: '暂时没有生成成功，请稍后重试。' })
    }
    const weekly = id !== 'p1'
    return wrap({
      id,
      status: 'ready',
      title: weekly ? '成长周报' : '阶段成长报告',
      range: weekly ? '2026.08.18 – 2026.08.25' : 'L2 机械与运动 · 21 天',
      generatedAt: '2026-08-25 21:16',
      sufficiency: '数据充分',
      sections: weekly
        ? [
            { title: '本周变化', body: '观察稳定性与主动追问次数上升，来自 11 次提问记录与 2 项项目成果。' },
            { title: '代表足迹', body: '「为什么火箭能在太空中改变方向？」连续追问 3 次，并完成一次主动验证。' },
            { title: '陪伴建议', body: '请孩子用自己的话复述推进方向，不评价对错，只确认表达是否完整。' }
          ]
        : [
            { title: '阶段概览', body: '在机械与运动主题中，孩子完成波形挑战与机械臂协作项目。' },
            { title: '能力变化', body: '探究、观察两项相对突出；创造维度证据仍偏少。' },
            { title: '下一阶段', body: '建议继续保留「先观察再行动」的步骤，不额外增加评分类任务。' }
          ]
    })
  },

  getFamily() {
    const s = store.getSession()
    const invites = store.getInvites()
    const pending = invites.u3 === 'pending'
    const accepted = invites.u3 === 'accepted'
    const transferred = s.role !== '主管理员'
    const members = [
      { id: 'u1', name: '陈然', role: transferred ? '普通成员' : '主管理员', relation: s.relation || '妈妈', status: '已加入' },
      { id: 'u2', name: '林屿', role: transferred ? '主管理员' : '普通成员', relation: '爸爸', status: '已加入' }
    ]
    if (pending) {
      members.push({ id: 'u3', name: '周屿', role: '待确认', relation: '监护人', status: '邀请待处理', pending: true })
    } else if (accepted) {
      members.push({ id: 'u3', name: '周屿', role: '普通成员', relation: '监护人', status: '已加入' })
    }
    return wrap({
      name: s.familyName || '林小满的家庭',
      admin: transferred ? '林屿' : '陈然',
      members,
      children: activeChildren()
    })
  },

  acceptInvite(id) {
    return this.submitTask('invite-accept', { id })
  },

  rejectInvite(id) {
    return this.submitTask('invite-reject', { id })
  },

  getDevices() {
    const hidden = store.getDemoData('unboundDevices', [])
    return wrap(activeChildren().filter((c) => hidden.indexOf(c.deviceId) < 0).map((c) => ({
      id: c.deviceId,
      name: c.deviceName,
      childName: c.name,
      online: c.online,
      battery: c.battery,
      firmware: '1.4.2',
      locate: c.online ? '定位有效' : '离线',
      updatedAt: c.online ? '20 秒前' : '36 分钟前'
    })))
  },

  getMessages() {
    if (store.getScenario() === 'empty') return wrap([])
    const child = currentChild()
    const readIds = store.getReadMessageIds()
    const msgs = [
      { id: 'm1', type: '家庭', title: '周屿申请加入家庭', time: '今天 15:40', unread: store.getInvites().u3 === 'pending', url: '/pages/my/family' }
    ]
    if (child.battery < 20) {
      msgs.push({ id: 'm2', type: '守护', title: child.deviceName + ' 电量低于 20%', time: '今天 18:02', unread: true, url: '/pages/my/device' })
    }
    msgs.push(
      { id: 'm3', type: '成长', title: '本周成长周报已生成', time: '昨天 21:16', unread: false, url: '/pages/growth/weekly' },
      { id: 'm4', type: '系统', title: '儿童信息处理规则已更新', time: '8 月 20 日', unread: false, url: '/pages/my/policy' }
    )
    return wrap(msgs.map((item) => Object.assign({}, item, { unread: !!item.unread && readIds.indexOf(item.id) < 0 })))
  },

  markMessageRead(id) {
    store.markMessageRead(id)
    return wrap({ ok: true })
  },

  getGuide() {
    return wrap([
      { id: 'g1', title: '绑定 Mini 设备', status: '已完成', desc: '家庭与设备关系已建立', url: '/pages/family/bind' },
      { id: 'g2', title: '查看实时守护', status: '已完成', desc: '地图只展示当前有效位置', url: '/pages/guard/index' },
      { id: 'g3', title: '语音通话', status: '进行中', desc: '呼叫前会检查设备在线状态', url: '/pages/guard/call' },
      { id: 'g4', title: '通讯录与紧急联系人', status: '未开始', desc: '同步结果以设备最终状态为准', url: '/pages/guard/contacts' },
      { id: 'g5', title: '查找设备与闹钟', status: '未开始', desc: '响铃最长 60 秒，可随时停止', url: '/pages/guard/find' }
    ])
  },

  getAchievement(id) {
    const child = currentChild()
    const map = {
      a1: {
        id: 'a1',
        title: '声音波形挑战',
        image: '/assets/illustrations/result-sound-v2.jpg',
        source: 'Web 互动实验',
        date: '8 月 25 日',
        childAlias: child.shortName,
        process: '完成波形挑战后形成「细心观察」互动成果，过程记录可追溯。',
        evidence: '观察稳定性相关事件 1 条'
      },
      a2: {
        id: 'a2',
        title: '机械臂协作项目',
        image: '/assets/illustrations/result-robot-arm-v2.jpg',
        source: '项目实践',
        date: '8 月 23 日',
        childAlias: child.shortName,
        process: '在协作操作中加入「先扫描再抓取」，形成项目成果。',
        evidence: '协作表达相关事件 1 条'
      }
    }
    return wrap(map[id] || map.a1)
  },

  getSharePreview(id) {
    const child = currentChild()
    const generating = store.getScenario() === 'generating'
    return wrap({
      id: id || 'w1',
      generating,
      title: '成长周报（脱敏）',
      childAlias: child.shortName,
      range: '本周',
      body: '观察与表达更稳定，依据近期提问记录与项目成果整理。',
      hidden: ['全名', '位置', '设备 ID', '精确时刻']
    })
  },

  regenerateReport(id) {
    return this.submitTask('report-regen', { id: id || 'w1' })
  },

  getPrivacyRequest(type) {
    return wrap(store.getDemoData('privacyRequests.' + type, null), 80)
  },

  submitTask(type, payload) {
    taskSequence += 1
    const id = 'task-' + Date.now() + '-' + taskSequence
    const task = {
      id,
      type,
      payload: payload || {},
      status: 'submitted',
      createdAt: Date.now(),
      message: taskMessage(type, 'submitted')
    }
    store.setTask(id, task)
    setTimeout(() => {
      store.setTask(id, Object.assign({}, task, { status: 'executing', message: taskMessage(type, 'executing') }))
    }, 500)
    setTimeout(() => {
      const fail = store.getScenario() === 'fail'
      const timeout = store.getScenario() === 'timeout'
      const finalStatus = fail ? 'failed' : timeout ? 'timeout' : 'success'
      if (finalStatus === 'success') applyTaskMutation(type, payload || {})
      store.setTask(id, Object.assign({}, task, {
        status: finalStatus,
        message: taskMessage(type, finalStatus),
        finishedAt: Date.now()
      }))
    }, 1800)
    return wrap(task, 180)
  },

  getTask(id) {
    const task = store.getTasks()[id]
    return wrap(task || { id, status: 'unknown', message: '未找到任务' }, 120)
  }
}

module.exports = mock
