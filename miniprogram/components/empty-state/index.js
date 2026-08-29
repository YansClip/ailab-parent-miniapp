Component({
  properties: {
    title: { type: String, value: '暂时还没有内容' },
    desc: { type: String, value: '产生有效数据后会出现在这里，空状态不会自动补数。' },
    action: { type: String, value: '' },
    icon: { type: String, value: '·' },
    tone: { type: String, value: 'lavender' },
    busy: { type: Boolean, value: false }
  },
  methods: {
    onTap() {
      if (!this.data.busy) this.triggerEvent('action')
    }
  }
})
