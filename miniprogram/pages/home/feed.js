const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [] },
  onShow() {
    api.getHome().then((h) => this.setData({ list: h.dynamics || [] })).catch((e) => util.failToast(e))
  }
})
