Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/home/index',
        text: '首页',
        iconPath: '/assets/tab/home-off.png',
        selectedIconPath: '/assets/tab/home-on.png'
      },
      {
        pagePath: '/pages/guard/index',
        text: '守护',
        iconPath: '/assets/tab/guard-off.png',
        selectedIconPath: '/assets/tab/guard-on.png'
      },
      {
        pagePath: '/pages/growth/index',
        text: '成长',
        iconPath: '/assets/tab/growth-off.png',
        selectedIconPath: '/assets/tab/growth-on.png'
      },
      {
        pagePath: '/pages/my/index',
        text: '我的',
        iconPath: '/assets/tab/my-off.png',
        selectedIconPath: '/assets/tab/my-on.png'
      }
    ]
  },
  methods: {
    onSwitch(e) {
      const { index, path } = e.currentTarget.dataset
      if (index === this.data.selected) return
      wx.switchTab({
        url: path,
        success: () => this.setData({ selected: index }),
        fail: () => wx.showToast({ title: '页面暂时无法打开', icon: 'none' })
      })
    }
  }
})
