const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { family: { members: [] }, loading: true, error: '', isAdmin: false, busy: false, task: null },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => Promise.all([api.getFamily(), api.getParent()]), ([family, p]) => ({ family, isAdmin: p.role === '主管理员' })) },
  goChild() { util.navigate('/pages/my/child') },
  goTransfer() { util.navigate('/pages/my/transfer') },
  async accept(e) { await this.invite(e.currentTarget.dataset.id, true) },
  async reject(e) { if (await util.confirm('拒绝邀请', '拒绝后该成员不会加入家庭，可重新发起申请。')) await this.invite(e.currentTarget.dataset.id, false) },
  async invite(id, accept) {
    if (this.data.busy || !this.data.isAdmin) return
    this.setData({ busy: true })
    try {
      const t = await (accept ? api.acceptInvite(id) : api.rejectInvite(id))
      const result = await util.pollTask(t.id, { page: this, onUpdate: (task) => util.safeSetData(this, { task }) })
      if (!util.pageMounted(this) || result.status === 'cancelled') return
      util.toast(result.message)
      if (result.status === 'success') await this.reload()
    } catch (e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy: false }) }
  },
  onUnload() { util.disposePage(this) }
})
