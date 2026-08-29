const store = require('../../services/store')

Component({
  properties: {
    show: { type: Boolean, value: false },
    children: { type: Array, value: [] },
    currentId: { type: String, value: '' }
  },
  methods: {
    noop() {},
    onClose() {
      this.triggerEvent('close')
    },
    onPick(e) {
      const id = e.currentTarget.dataset.id
      if (id === this.data.currentId) {
        this.triggerEvent('close')
        return
      }
      store.setCurrentChildId(id)
      this.triggerEvent('change', { id })
      this.triggerEvent('close')
    }
  }
})
