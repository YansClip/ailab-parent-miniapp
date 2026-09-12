const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { task: null, busy: false, loading: true, error: '', members: [], selectedId: '', isAdmin: false, done: false },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => Promise.all([api.getFamily(), api.getParent()]), ([family, parent]) => ({
    isAdmin: parent.role === '主管理员',
    members: family.members.filter((m) => !m.pending && m.role !== '主管理员' && m.name !== parent.name)
  })) },
  select(e) { if (!this.data.busy) this.setData({ selectedId: e.currentTarget.dataset.id }) },
  async go() {
    if (!this.data.isAdmin || this.data.busy) return
    const member = this.data.members.find((m) => m.id === this.data.selectedId)
    if (!member) return util.toast('请先选择一位已加入的家庭成员')
    if (!await util.confirm('转移给' + member.name, '完成后你将成为普通成员，不能再管理成员或解绑设备。请确认对方具备有效监护关系。')) return
    await helper.task(this, 'admin-transfer', { memberId: member.id }, () => util.safeSetData(this, { done: true, isAdmin: false }))
  },
  onUnload() { util.disposePage(this) }
})
