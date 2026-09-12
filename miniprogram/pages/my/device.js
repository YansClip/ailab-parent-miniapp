const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { list: [], loading: true, error: '', busy: false, task: null },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => api.getDevices(), (list) => ({ list })) },
  detail(e) { util.navigate('/pages/my/device-detail?id=' + encodeURIComponent(e.currentTarget.dataset.id)) },
  async bind() {
    if (!await util.confirm('绑定 Mini 设备', '将为当前孩子恢复本地示例设备的绑定关系。真实产品需完成设备身份核验。')) return
    await helper.task(this, 'device-bind', {}, () => this.reload())
  },
  onUnload() { util.disposePage(this) }
})
