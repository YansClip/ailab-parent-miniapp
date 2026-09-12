const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { enabled: false, busy: false, loading: true, error: '', task: null },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => api.getSubscription(), (value) => ({ enabled: typeof value === 'boolean' ? value : !!value.enabled })) },
  async ask() {
    if (this.data.busy) return
    const enabled = !this.data.enabled
    if (enabled && !await util.confirm('开启示例订阅状态', '仅保存本地偏好，不会向微信申请真实订阅或发送通知。取消后仍可查看站内消息。')) return
    await helper.task(this, 'subscription-update', { enabled }, () => this.reload())
  },
  onUnload() { util.disposePage(this) }
})
