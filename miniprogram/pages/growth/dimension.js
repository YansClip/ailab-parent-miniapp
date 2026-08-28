const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { dim: {} },
  onLoad(q) {
    api.getGrowth().then((g) => {
      const dim = (g.dimensions || []).find((d) => d.key === q.key) || (g.dimensions || [])[0] || {}
      this.setData({ dim })
    }).catch((e) => util.failToast(e))
  }
})
