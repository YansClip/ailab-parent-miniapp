const api = require('../../services/api')
const util = require('../../utils/util')
const helper = require('./helper')
Page({
  data: { list: [], loaded: false, loading: true, error: '', busy: false },
  onShow() { this.reload() },
  reload() { return helper.load(this, () => api.getMessages(), (list) => ({ list, loaded: true })) },
  sub() { util.navigate('/pages/my/subscribe') },
  async open(e) {
    if (this.data.busy) return
    const item = this.data.list.find((m) => m.id === e.currentTarget.dataset.id)
    if (!item) return
    this.setData({ busy: true })
    try {
      await api.markMessageRead(item.id)
      if (!util.pageMounted(this)) return
      this.setData({ list: this.data.list.map((m) => m.id === item.id ? Object.assign({}, m, { unread: false }) : m) })
      if (item.url) util.navigate(item.url)
      else await util.confirm(item.title, item.body || item.desc || '这条消息没有需要进一步处理的事项。')
    } catch (e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy: false }) }
  },
  onUnload() { util.disposePage(this) }
})
