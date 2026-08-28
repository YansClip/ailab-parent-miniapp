Page({
  data: {
    faqs: [
      { id: 'f1', q: '位置显示已过期？', a: '超过有效期后会清除坐标，不会把缓存位置当作当前。可在守护页刷新位置。', open: false },
      { id: 'f2', q: '绑定码失效怎么办？', a: '绑定码一次性有效。过期或已使用时，请让孩子重新生成后再提交。', open: false },
      { id: 'f3', q: '通话失败如何重试？', a: '先确认设备在线。离线无法呼叫。接通失败可返回准备页再次呼叫。', open: false }
    ]
  },
  goFb() { wx.navigateTo({ url: '/pages/my/feedback' }) },
  toggle(e) {
    const id = e.currentTarget.dataset.id
    const faqs = this.data.faqs.map((f) => f.id === id ? Object.assign({}, f, { open: !f.open }) : f)
    this.setData({ faqs })
  }
})
