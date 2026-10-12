const store = require('../../services/store')

Component({
  properties: {
    show: { type: Boolean, value: false },
    children: { type: Array, value: [] },
    currentId: { type: String, value: '' },
    external: { type: Boolean, value: false }
  },
  methods: {
    noop() {},
    onClose() {
      this.triggerEvent('close')
    },
    async onPick(e) {
      const id = e.currentTarget.dataset.id
      if (id === this.data.currentId) {
        this.triggerEvent('close')
        return
      }
      if (!this.data.external) {
        try {
          const api = require('../../services/api')
          if (api.getDeviceMode() === 'demo') {
            const call = await api.getCallSession()
            if (call && ['preparing','calling','ringing','connecting','connected','ending'].includes(call.stage)) {
              wx.showToast({ title: '请先结束当前通话，再切换孩子', icon: 'none' }); return
            }
          }
          store.setCurrentChildId(id)
        } catch (err) { wx.showToast({ title: err.message || '暂不能切换，请重试', icon: 'none' }); return }
      }
      this.triggerEvent('change', { id })
      this.triggerEvent('close')
    }
  }
})
