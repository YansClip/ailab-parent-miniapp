const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { brief: {} },
  onShow() {
    api.getGrowth().then((g) => {
      const brief = g.brief || {}
      brief.concepts = (brief.concepts || []).join('、')
      this.setData({ brief })
    }).catch((e) => util.failToast(e))
  }
})
