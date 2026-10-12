const test = require('node:test')
const { memoryRepository } = require('./fixtures/device-integration')
const { syntheticFamilyChecks } = require('./fixtures/synthetic-family-checks')

test('虚构家庭：读写、绑定生命周期和权限隔离（本机内存）', async t => {
  await syntheticFamilyChecks(t, memoryRepository())
})
