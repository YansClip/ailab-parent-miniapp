const test = require('node:test')
const assert = require('node:assert/strict')
const { buildCuriosityCards, groupCards } = require('../miniprogram/pages/home/curiosity-cards')

test('好奇心卡片合并同一事件，保留图片、详情地址及时间倒序', () => {
  const cards = buildCuriosityCards({ childId: 'a', dynamics: [
    { id: 'q1', childId: 'a', type: 'question', date: '2026-10-08', occurredAt: 20, title: '为什么？', url: '/pages/home/footprint?id=q1' },
    { id: 'r1', childId: 'a', type: 'achievement', date: '2026-10-07', occurredAt: 10, title: '成果' }
  ], footprints: [{ id: 'q1', childId: 'a', tag: '主动提问', desc: '一次对照观察' }], achievements: [
    { id: 'r1', childId: 'a', type: '探索成果', image: '/assets/illustrations/result-sound-v2.jpg', url: '/pages/growth/achievement?id=r1' }
  ] })
  assert.equal(cards.length, 2)
  assert.deepEqual(cards.map(x => x.kind), ['question', 'achievement'])
  assert.equal(cards[0].description, '一次对照观察')
  assert.equal(cards[0].url, '/pages/home/footprint?id=q1')
  assert.equal(cards[1].image, '/assets/illustrations/result-sound-v2.jpg')
  assert.equal(groupCards(cards).length, 2)
})
test('好奇心卡片不混入其他孩子的记录，空集合可恢复', () => {
  const home = { child: { id: 'a' }, dynamics: [{ id: 'foreign', childId: 'b', type: 'question' }], footprints: [], achievements: [] }
  assert.deepEqual(buildCuriosityCards(home), [])
  assert.deepEqual(groupCards([]), [])
  home.dynamics.push({ id: 'own', childId: 'a', type: 'course-completed', courseId: 'S01', date: '2026-10-08' })
  assert.equal(buildCuriosityCards(home)[0].kind, 'discovery')
})
