Component({
  properties: {
    title: { type: String, value: '暂时还没有内容' },
    desc: { type: String, value: '有正式事件后会出现在这里，不会用模拟数据填充。' },
    action: { type: String, value: '' }
  },
  methods: {
    onTap() {
      this.triggerEvent('action')
    }
  }
})
