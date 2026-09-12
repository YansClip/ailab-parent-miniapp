const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { task: null, busy: false, loading: true, error: '', isAdmin: false, child: {}, name: '', note: '', result: null },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => Promise.all([api.getContext(), api.getPrivacyRequest('child-data-request')]), ([ctx, task]) => ({ child: ctx.child || {}, name: ctx.child ? ctx.child.name : '', isAdmin: ctx.role === '主管理员', task })) },
  inputName(e) { this.setData({ name: e.detail.value }) },
  inputNote(e) { this.setData({ note: e.detail.value }) },
  async submit() {
    await helper.task(this, 'child-data-request', { action: 'view' }, (t) => util.safeSetData(this, { result: t.result || { child: this.data.child } }))
  },
  async correct() {
    const name = this.data.name.trim()
    if (!name || name.length > 20) return util.toast('请输入 1–20 字的孩子称呼')
    if (!await util.confirm('更正孩子称呼', '将更新当前孩子的本地称呼，不修改其他孩子的资料。')) return
    await helper.task(this, 'child-data-request', { action: 'correct', name, note: this.data.note.trim() }, () => this.reload())
  },
  onUnload() { util.disposePage(this) }
})
