const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [], loading: true, error: '' },
  onShow() {
    this.load()
  },
  onUnload() { util.disposePage(this) },
  load() {
    const version = util.beginRequest(this, 'feed')
    util.safeSetData(this, { loading: true, error: '' })
    api.getHome().then((home) => {
      if (!util.isRequestCurrent(this, 'feed', version)) return
      util.safeSetData(this, { list: home.dynamics || [], loading: false })
    }).catch((error) => {
      if (!util.isRequestCurrent(this, 'feed', version)) return
      util.safeSetData(this, { loading: false, error: error.message || '动态暂时加载失败' })
    })
  }
})
