const store = require('./store')

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

function currentChild() {
  const id = store.getCurrentChildId()
  return CHILDREN.find((c) => c.id === id) || CHILDREN[0]
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
    return wrap(CHILDREN)
  },

  getHome() {
    const scenario = store.getScenario()
    const child = currentChild()
    if (scenario === 'empty') {
      return wrap({
        child,
        greeting: greeting(),
        empty: true,
        summary: { dynamics: 0, onlineMinutes: 0, todos: 0, deviceOnline: child.online },
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
        image: '/assets/images/hero.jpg',
        title: '今天，也在好好长大',
        subtitle: isXinghe ? '设备当前离线 · 成长记录仍可查看' : '新增 3 条陪伴动态 · 1 项待处理'
      },
      summary: {
        dynamics: isXinghe ? 1 : 3,
        onlineMinutes: isXinghe ? 0 : 26,
        todos: isXinghe ? 1 : 1,
        deviceOnline: child.online
      },
      photos: isXinghe ? [] : [
        { src: '/assets/photos/photo1.jpg' },
        { src: '/assets/photos/photo2.jpg' },
        { src: '/assets/photos/photo3.jpg' }
      ],
      photoCard: isXinghe ? null : {
        title: '声波实验被 Mini 拍下了',
        time: '17:28',
        desc: '小满完成波形挑战后，设备自动生成了这条陪伴记录。'
      },
      dynamics: isXinghe
        ? [
            { id: 'd4', icon: '/assets/icons/dot-coral.png', title: 'Mini 02 已离线', desc: '守护工具暂不可用', time: '12:08', tone: 'coral' }
          ]
        : [
            { id: 'd1', icon: '/assets/icons/dot-lavender.png', title: '完成声音波形挑战', desc: '获得「细心观察」互动成果', time: '17:28', tone: 'lavender' },
            { id: 'd2', icon: '/assets/icons/dot-mint.png', title: 'Mini 01 已恢复在线', desc: '位置与电量状态已更新', time: '16:55', tone: 'mint' },
            { id: 'd3', icon: '/assets/icons/dot-coral.png', title: '家庭邀请待处理', desc: '周屿申请成为普通监护人', time: '15:40', tone: 'butter' }
          ],
      footprints: [
        { id: 'fp1', date: '8 月 25 日', tag: '提出一个好问题', tagTone: 'lavender', title: '为什么火箭能在太空中改变方向？', desc: '从推进器演示开始，连续追问了 3 次', tone: 'lavender' },
        { id: 'fp2', date: '8 月 24 日', tag: '发现一个新词', tagTone: 'butter', title: 'orbit / 轨道', desc: '用自己的话解释了“绕着转”的含义', tone: 'butter' },
        { id: 'fp3', date: '8 月 23 日', tag: '完成一次观点表达', tagTone: 'mint', title: '我认为机器人也需要先观察再行动', desc: '形成了完整的理由与例子', tone: 'mint' }
      ],
      achievements: [
        { id: 'a1', type: '互动成果', title: '声音波形挑战', extra: '观察稳定性 +8', tone: 'lavender' },
        { id: 'a2', type: '项目成果', title: '机械臂协作演示', extra: '协作表达 +6', tone: 'mint' }
      ],
      suggestion: {
        title: '今日陪伴建议',
        text: '请小满说说“为什么这样判断”，帮助表达与逻辑同步成长。'
      },
      todos: (function () {
        const list = []
        if (!child.online) {
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
        source: 'Web 互动实验 · 正式事件 #E-0825-03'
      },
      fp2: {
        id: 'fp2',
        date: '2026 年 8 月 24 日',
        type: '概念发现',
        title: 'orbit / 轨道',
        scene: '行星运动课包',
        summary: '小满第一次使用“轨道”这个词，并用“绕着转、不会掉下去”解释自己的理解。',
        concepts: ['轨道', '圆周运动'],
        follow: '把轨道画成一条闭合的线，而不是直线冲出去。',
        source: '项目实践 · 正式事件 #E-0824-11'
      },
      fp3: {
        id: 'fp3',
        date: '2026 年 8 月 23 日',
        type: '观点表达',
        title: '我认为机器人也需要先观察再行动',
        scene: '机械臂协作演示',
        summary: '小满提出：如果机械臂不先看看周围，就容易撞到积木。她用两次对比实验说明理由。',
        concepts: ['观察', '安全', '计划'],
        follow: '在演示中加入了“先扫描再抓取”的步骤。',
        source: '项目成果 · 正式事件 #E-0823-07'
      }
    }
    const item = map[id] || map.fp1
    item.followed = !!store.getFollows()[item.id]
    return wrap(item)
  },

  getLocation() {
    const scenario = store.getScenario()
    const child = currentChild()
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
    return wrap([
      { id: 'c1', name: '陈然', relation: '妈妈', phone: '138****2160', deviceCall: true, sos: sos.indexOf('c1') >= 0 },
      { id: 'c2', name: '林屿', relation: '爸爸', phone: '139****8801', deviceCall: true, sos: sos.indexOf('c2') >= 0 },
      { id: 'c3', name: '周老师', relation: '班主任', phone: '137****4412', deviceCall: false, sos: sos.indexOf('c3') >= 0 }
    ])
  },

  getContact(id) {
    return this.getContacts().then((list) => list.find((c) => c.id === id) || null)
  },

  saveContact(payload) {
    return this.submitTask('contact-sync', payload)
  },

  getAlarms() {
    return wrap([
      { id: 'al1', time: '07:20', label: '起床', repeat: '周一至周五', enabled: true, synced: true },
      { id: 'al2', time: '21:00', label: '晚安', repeat: '每天', enabled: true, synced: true }
    ])
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
    store.setSosIds(next)
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
        { id: 'w1', type: 'weekly', title: '成长周报', range: '8/18 – 8/25', status: 'ready', version: '规则 v2.4' },
        { id: 'p1', type: 'phase', title: '阶段成长报告', range: 'L2 机械与运动', status: 'ready', version: '规则 v2.4' }
      ],
      achievements: [
        { id: 'a1', title: '声音波形挑战', time: '8 月 25 日', source: '互动实验' },
        { id: 'a2', title: '机械臂协作演示', time: '8 月 23 日', source: '项目实践' }
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
      return wrap({ id, status: 'generating', title: '正在生成报告', range: '8/18 – 8/25', version: '规则 v2.4' }, 200)
    }
    if (failed) {
      return wrap({ id, status: 'failed', title: '生成失败', range: '8/18 – 8/25', message: '数据服务超时，可重试。错误追踪 AIL-9F2C' })
    }
    const weekly = id !== 'p1'
    return wrap({
      id,
      status: 'ready',
      title: weekly ? '成长周报' : '阶段成长报告',
      range: weekly ? '2026.08.18 – 2026.08.25' : 'L2 机械与运动 · 21 天',
      generatedAt: '2026-08-25 21:16',
      version: '评估规则 v2.4',
      sufficiency: '数据充分',
      sections: weekly
        ? [
            { title: '本周变化', body: '观察稳定性与主动追问次数上升。结论来自 11 次正式提问事件与 2 项项目成果。' },
            { title: '代表足迹', body: '「为什么火箭能在太空中改变方向？」连续追问 3 次，并完成一次主动验证。' },
            { title: '陪伴建议', body: '请孩子用自己的话复述推进方向，不评价对错，只确认表达是否完整。' }
          ]
        : [
            { title: '阶段概览', body: '在机械与运动主题中，孩子完成波形挑战与机械臂协作演示。' },
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
    const members = [
      { id: 'u1', name: '陈然', role: '主管理员', relation: s.relation || '妈妈', status: '已加入' },
      { id: 'u2', name: '林屿', role: '普通成员', relation: '爸爸', status: '已加入' }
    ]
    if (pending) {
      members.push({ id: 'u3', name: '周屿', role: '待确认', relation: '监护人', status: '邀请待处理', pending: true })
    } else if (accepted) {
      members.push({ id: 'u3', name: '周屿', role: '普通成员', relation: '监护人', status: '已加入' })
    }
    return wrap({
      name: s.familyName || '林小满的家庭',
      admin: '陈然',
      members,
      children: CHILDREN
    })
  },

  acceptInvite(id) {
    store.setInvite(id, 'accepted')
    return this.submitTask('invite-accept', { id })
  },

  rejectInvite(id) {
    store.setInvite(id, 'rejected')
    return this.submitTask('invite-reject', { id })
  },

  getDevices() {
    return wrap(CHILDREN.map((c) => ({
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
    return wrap(msgs)
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
        source: 'Web 互动实验',
        date: '8 月 25 日',
        childAlias: child.shortName,
        process: '完成波形挑战后形成「细心观察」互动成果。来源为正式事件，不以演示分数填充。',
        evidence: '观察稳定性相关事件 1 条'
      },
      a2: {
        id: 'a2',
        title: '机械臂协作演示',
        source: '项目实践',
        date: '8 月 23 日',
        childAlias: child.shortName,
        process: '在协作演示中加入「先扫描再抓取」，形成项目成果。',
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
      body: '观察与表达更稳定。依据正式提问与项目成果，规则 v2.4。',
      hidden: ['全名', '位置', '设备 ID', '精确时刻']
    })
  },

  regenerateReport(id) {
    return this.submitTask('report-regen', { id: id || 'w1' })
  },

  submitTask(type, payload) {
    const id = 'task-' + Date.now()
    const task = {
      id,
      type,
      payload: payload || {},
      status: 'submitted',
      createdAt: Date.now(),
      message: '请求已提交'
    }
    store.setTask(id, task)
    setTimeout(() => {
      store.setTask(id, Object.assign({}, task, { status: 'executing', message: '设备执行中' }))
    }, 500)
    setTimeout(() => {
      const fail = store.getScenario() === 'fail'
      const timeout = store.getScenario() === 'timeout'
      store.setTask(id, Object.assign({}, task, {
        status: fail ? 'failed' : timeout ? 'timeout' : 'success',
        message: fail ? '同步失败，可重试' : timeout ? '等待超时，可查询最终状态' : '设备已确认完成',
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
