const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { list: [], loading: true, error: '', task: null, busy: false, isAdmin: false },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => Promise.all([api.getChildren(), api.getParent()]), ([list, p]) => ({ list, isAdmin: p.role === '主管理员' })) },
  bind() { util.navigate('/pages/family/bind') },
  async unbind(e) {
    if (!this.data.isAdmin) return util.toast('此操作仅限主管理员')
    if (this.data.busy) return
    const id = e.currentTarget.dataset.id
    const child = this.data.list.find((c) => c.id === id)
    if (!child) return
    if (!await util.confirm('解除孩子关系', '解除与' + child.name + '的关联后，将停止查看其成长、设备与位置。其他孩子的数据不受影响。')) return
    await helper.task(this, 'child-unbind', { id }, () => this.reload())
  },
  onUnload() { util.disposePage(this) }
})
