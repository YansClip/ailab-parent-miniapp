function cloudRepository(db) {
  function wrap(client) {
    return {
      async get(collection, id) {
        try { const r = await client.collection(collection).doc(id).get(); return r.data || null }
        catch (e) { if (e.errCode === -502004 || /document.*not.*exist/i.test(e.errMsg || e.message || '')) return null; throw e }
      },
      async put(collection, id, value) { const data = Object.assign({}, value); delete data._id; await client.collection(collection).doc(id).set({ data }); return value },
      async remove(collection, id) { await client.collection(collection).doc(id).remove() },
      async list(collection, where) {
        const all = []
        for (let offset = 0; ; offset += 100) {
          const r = await client.collection(collection).where(where).skip(offset).limit(100).get()
          all.push(...r.data)
          if (r.data.length < 100) return all
          if (all.length >= 1000) throw Object.assign(new Error('关系数量超出本次查询限制，请联系管理员'), { code: 'RELATION_LIMIT' })
        }
      }
    }
  }
  return Object.assign(wrap(db), { transaction: fn => db.runTransaction(tx => fn(wrap(tx))) })
}
module.exports = { cloudRepository }
