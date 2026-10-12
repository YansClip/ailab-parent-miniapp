// Test-only fixtures. No real OpenID, children, coordinates, credentials or hardware.
const assert = require('node:assert/strict')
const { createService, collections: C } = require('../../cloudfunctions/miniDeviceGateway/lib/service')
const { createRuntime } = require('../../server/mini-device-cloudrun/runtime')
const { readConfig } = require('../../server/mini-device-cloudrun/config')

async function syntheticFamilyChecks(t, repo, reader = repo) {
  const config = readConfig({ MINI_APP_ID: 'synthetic-app', LOCATION_PROVIDER: 'disabled', VOIP_PROVIDER: 'disabled' })
  const user = name => ({ openid: 'qa-fictional-parent-' + name, appid: config.appid, source: 'wx-cloudrun-gateway' })
  const a = user('a'), b = user('b')
  const scope = name => ({ familyId: 'qa-fictional-family-' + name, childId: 'qa-fictional-child-' + name, deviceId: 'qa-fictional-device-' + name, bindingVersion: 1 })
  const sa = scope('a'), sb = scope('b')
  const binding = s => ({ ...s, active: true, childName: '虚构角色，仅用于测试', deviceName: '虚构设备，不连接硬件', synthetic: true })
  const member = (u, s) => ({ openid: u.openid, familyId: s.familyId, childIds: [s.childId], active: true, consentActive: true, permissions: { viewDevice: true, locateDevice: false, callDevice: false }, synthetic: true })
  const ma = member(a, sa), mb = member(b, sb)
  const records = [[C.members, 'qa-fictional-member-a', ma], [C.members, 'qa-fictional-member-b', mb], [C.bindings, sa.deviceId, binding(sa)], [C.bindings, sb.deviceId, binding(sb)]]
  let providerCalls = 0
  const provider = new Proxy({}, { get() { return async () => { providerCalls++; throw Error('No hardware access allowed in this test') } } })
  const service = createService({ repo: reader, provider, config })
  const runtime = createRuntime(config, { repo: reader, provider })
  const list = actor => runtime.dispatch('context.list', {}, actor)
  const writeMember = value => repo.put(C.members, 'qa-fictional-member-a', value)
  const writeBinding = value => repo.put(C.bindings, sa.deviceId, value)
  // Refuse to overwrite even another test's records.
  for (const [c, id] of records) assert.equal(await repo.get(c, id), null)
  try {
    await t.test('虚构记录写入后可读取，两个家庭只看到各自设备', async () => {
      for (const [c, id, value] of records) await repo.put(c, id, value)
      assert.deepEqual((await list(a)).map(x => x.deviceId), [sa.deviceId])
      assert.deepEqual((await list(b)).map(x => x.deviceId), [sb.deviceId])
      assert.equal((await service.authorize(a, sa)).deviceId, sa.deviceId)
      assert.equal((await reader.get(C.bindings, sa.deviceId)).childName, '虚构角色，仅用于测试')
    })
    await t.test('更新设备名称后其他读取连接可见，主键不产生重复记录', async () => {
      await writeBinding({ ...binding(sa), deviceName: '虚构设备-更新验证' })
      assert.equal((await list(a))[0].deviceName, '虚构设备-更新验证')
      assert.equal((await reader.list(C.bindings, { deviceId: sa.deviceId })).length, 1)
    })
    await t.test('跨家庭访问、客户端伪造身份和管理员角色均被拒绝', async () => {
      await assert.rejects(runtime.dispatch('device.status', { scope: sb, openid: b.openid, role: 'admin' }, a), { code: 'FORBIDDEN' })
      await assert.rejects(runtime.dispatch('device.status', { scope: sa }, b), { code: 'FORBIDDEN' })
      await assert.rejects(runtime.dispatch('context.list', {}, { ...a, source: 'client' }), { code: 'AUTH_REQUIRED' })
      await assert.rejects(runtime.dispatch('context.list', {}, { ...a, appid: 'wrong-app' }), { code: 'AUTH_REQUIRED' })
      assert.deepEqual(await list(user('stranger')), [])
    })
    await t.test('只读设备权限不包含定位或通话，也不能从客户端增加权限', async () => {
      await assert.rejects(runtime.dispatch('device.snapshot', { scope: sa, permissions: { locateDevice: true } }, a), { code: 'FORBIDDEN' })
      await assert.rejects(runtime.dispatch('call.prepare', { scope: sa, mediaType: 'voice', requestId: 'qa-call' }, a), { code: 'FORBIDDEN' })
      for (const action of ['admin.grant', 'binding.create', 'binding.update', 'maintenance', 'reconcileAccess']) {
        await assert.rejects(runtime.dispatch(action, { scope: sa, role: 'admin' }, a), { code: 'INVALID_ACTION' })
      }
    })
    await t.test('撤回同意、停用成员、移除孩子、撤销查看权限后立即不可读', async () => {
      for (const change of [{ consentActive: false }, { active: false }, { childIds: [] }, { permissions: { viewDevice: false } }]) {
        await writeMember({ ...ma, ...change })
        assert.deepEqual(await list(a), [])
        await assert.rejects(service.authorize(a, sa), { code: 'FORBIDDEN' })
        await writeMember(ma)
      }
    })
    await t.test('解绑后列表消失，旧设备请求不能继续访问', async () => {
      await writeBinding({ ...binding(sa), active: false, bindingVersion: 2 })
      assert.deepEqual(await list(a), [])
      await assert.rejects(service.authorize(a, sa), { code: 'BINDING_CHANGED' })
    })
    await t.test('换绑到家庭 B 后家庭 A 不可读，B 只接受新版绑定', async () => {
      const rebound = { ...sa, familyId: sb.familyId, childId: sb.childId, bindingVersion: 3 }
      await writeBinding(binding(rebound))
      assert.deepEqual(await list(a), [])
      assert.deepEqual((await list(b)).map(x => x.deviceId).sort(), [sa.deviceId, sb.deviceId].sort())
      await assert.rejects(service.authorize(a, sa), { code: 'BINDING_CHANGED' })
      await assert.rejects(service.authorize(a, rebound), { code: 'FORBIDDEN' })
      await assert.rejects(service.authorize(b, { ...rebound, bindingVersion: 2 }), { code: 'BINDING_CHANGED' })
      await assert.rejects(service.authorize(b, { ...rebound, childId: sa.childId }), { code: 'BINDING_CHANGED' })
      assert.equal((await service.authorize(b, rebound)).bindingVersion, 3)
    })
    await t.test('事务失败回滚绑定变更，原绑定保持不变', async () => {
      const before = await reader.get(C.bindings, sa.deviceId)
      await assert.rejects(repo.transaction(async tx => {
        await tx.put(C.bindings, sa.deviceId, { ...before, active: false })
        throw Object.assign(new Error('Synthetic rollback'), { code: 'QA_ROLLBACK' })
      }), { code: 'QA_ROLLBACK' })
      assert.deepEqual(await reader.get(C.bindings, sa.deviceId), before)
    })
    await t.test('全程未调用定位、声音、视频或设备服务', () => assert.equal(providerCalls, 0))
  } finally {
    // Exact fixtures only, never truncate a database or remove unrelated data.
    for (const [c, id] of records) await repo.remove(c, id)
  }
  await t.test('本轮虚构记录删除后不可读取，不遗留测试授权', async () => {
    for (const [c, id] of records) assert.equal(await reader.get(c, id), null)
    assert.deepEqual(await list(a), [])
    assert.deepEqual(await list(b), [])
  })
}
module.exports = { syntheticFamilyChecks }
