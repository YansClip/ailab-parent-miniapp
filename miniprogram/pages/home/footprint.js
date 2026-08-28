const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')
Page({
  data: { item: {}, followed: false },
  onLoad(q) {
    api.getFootprint(q.id || 'fp1').then((item) => this.setData({ item, followed: item.followed })).catch((e) => util.failToast(e))
  },
  toggle() {
    const on = store.toggleFollow(this.data.item.id)
    this.setData({ followed: on })
    util.toast(on ? '已关注，仅自己可见' : '已取消关注')
  }
})
