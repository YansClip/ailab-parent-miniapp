function createWxMock() {
  const storage = new Map()
  global.wx = {
    getStorageSync(key) { return storage.has(key) ? storage.get(key) : '' },
    setStorageSync(key, value) { storage.set(key, value) },
    showToast() {},
    showModal(options) { if (options.success) options.success({ confirm: true }) },
    login(options) {
      if (options.success) options.success({ code: 'mock-code' })
      if (options.complete) options.complete({ code: 'mock-code' })
    }
  }
  global.getCurrentPages = () => []
  global.getApp = () => ({ globalData: { statusBarHeight: 44 } })
  return { storage }
}

function fresh(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  return require(modulePath)
}

module.exports = { createWxMock, fresh }
