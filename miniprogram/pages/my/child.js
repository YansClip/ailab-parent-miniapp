const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [], task: null, busyId: '' },
  onShow() {
    api.getChildren().then((list) => this.setData({ list })).catch((e) => util.failToast(e))
  },
  async unbind(e) {
    if (this.data.list.length <= 1) {
      util.toast('演示家庭至少保留一名孩子')
      return
    }
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    const ok = await util.confirm('解除关系', '将停止对' + (name || '该孩子') + '的位置、成长与设备访问。不会误删其他家庭的合法数据。')
    if (!ok) return
    if (this.data.busyId) return
    this.setData({ busyId: id })
    api.submitTask('child-unbind', { id }).then((t) => {
      this.setData({ task: t })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => {
      util.toast(x.message)
      if (x.status === 'success') return api.getChildren().then((list) => this.setData({ list }))
      return null
    }).catch((err) => util.failToast(err)).finally(() => util.safeSetData(this, { busyId: '' }))
  }
})
