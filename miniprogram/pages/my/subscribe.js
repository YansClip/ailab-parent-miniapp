const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  data: { enabled: false, busy: false, task: null },
  onShow() { this.setData({ enabled: !!store.getDemoData('subscriptionEnabled', false) }) },
  ask() {
    if (this.data.busy) return
    const enabled = !this.data.enabled
    this.setData({ busy: true })
    api.submitTask('subscription-update', { enabled }).then((task) => {
      this.setData({ task })
      return util.pollTask(task.id, { page: this, onUpdate: (x) => this.setData({ task: x }) })
    }).then((result) => {
      if (result.status === 'success') this.setData({ enabled })
      util.toast(result.message)
    }).catch((e) => util.failToast(e)).finally(() => util.safeSetData(this, { busy: false }))
  }
})
