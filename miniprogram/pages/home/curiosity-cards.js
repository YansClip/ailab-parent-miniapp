// One event produces one card even when returned in multiple collections.
function buildCuriosityCards(home) {
  const childId = home.childId || (home.child || {}).id
  const records = new Map()
  ;[home.dynamics, home.footprints, home.achievements].forEach((list) => {
    ;(list || []).forEach((item) => {
      if (!item.id || (childId && item.childId && item.childId !== childId)) return
      records.set(item.id, Object.assign({}, records.get(item.id), item))
    })
  })
  const labels = { question: '好奇提问', achievement: '探索成果', 'course-completed': '探索发现', 'course-unlocked': '新的起点' }
  return Array.from(records.values()).map((item) => {
    const question = item.type === 'question' || !!item.tag
    const result = item.type === 'achievement' || item.type === '探索成果'
    const kind = question ? 'question' : result ? 'achievement' : 'discovery'
    const image = item.image || (question ? '/assets/island/robot-island.jpg' : item.courseId && item.courseId[0] === 'S' ? '/assets/illustrations/result-sound-v2.jpg' : '/assets/illustrations/result-robot-arm-v2.jpg')
    return Object.assign({}, item, {
      title: String(item.title || '一次新的发现').replace(/^(探索成果|完成探索内容|已解锁)\s*·\s*/, ''),
      kind, image, date: item.date || String(item.time || '').slice(0, 10) || '最近记录',
      label: labels[question ? 'question' : result ? 'achievement' : item.type] || '探索发现',
      description: item.desc || item.extra || '一次新的探索，留下了一份值得回看的记录。',
      imageLabel: result ? '成果记录' : '主题配图',
      action: question ? '看看这次提问' : result ? '查看探索成果' : '回看探索记录',
      icon: '/assets/icons/lucide/' + (result ? 'document' : 'sparkles') + '.png',
      url: item.url || (question ? '/pages/home/footprint?id=' + encodeURIComponent(item.id) : result ? '/pages/growth/achievement?id=' + encodeURIComponent(item.id) : '/pages/growth/index')
    })
  }).sort((a, b) => (Number(b.occurredAt) || Date.parse(b.date) || 0) - (Number(a.occurredAt) || Date.parse(a.date) || 0) || String(a.id).localeCompare(String(b.id)))
}
function groupCards(cards) {
  const groups = []
  cards.forEach((card) => {
    let group = groups.find((item) => item.date === card.date)
    if (!group) { group = { date: card.date, items: [] }; groups.push(group) }
    group.items.push(card)
  })
  return groups
}
module.exports = { buildCuriosityCards, groupCards }
