const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { dev: {}, confirm: false, task: null, busy: false },
  onLoad(q) {
    api.getDevices().then((list) => this.setData({ dev: list.find((d) => d.id === q.id) || list[0] || {} })).catch((e) => util.failToast(e))
  },
  unbind() { this.setData({ confirm: true }) },
  close() { this.setData({ confirm: false }) },
  noop() {},
  ok() {
    if (this.data.busy) return
    this.setData({ busy: true })
    api.submitTask('device-unbind', { id: this.data.dev.id }).then((t) => {
      this.setData({ task: t, confirm: false })
      return util.pollTask(t.id, { onUpdate: (x) => this.setData({ task: x }) })
    }).then((x) => util.toast(x.message)).catch((e) => util.failToast(e)).finally(() => this.setData({ busy: false }))
  }
})
