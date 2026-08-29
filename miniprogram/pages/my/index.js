const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: {
    statusBarHeight: 44,
    parent: {},
    child: {},
    children: [],
    family: { members: [] },
    device: {},
    showSwitcher: false,
    loading: true,
    error: '',
    groups: [
      {
        title: '家庭与设备',
        items: [
          { icon: '/assets/icons/lucide/family.png', title: '家庭管理', desc: '家庭成员、孩子与管理员权限', url: '/pages/my/family', tone: 'lavender' },
          { icon: '/assets/icons/lucide/device.png', title: '设备中心', desc: '设备状态、固件与解绑', url: '/pages/my/device', tone: 'sky' },
          { icon: '/assets/icons/lucide/guide.png', title: '玩机指南', desc: '守护与设备工具使用说明', url: '/pages/my/guide', tone: 'mint' }
        ]
      },
      {
        title: '消息与服务',
        items: [
          { icon: '/assets/icons/lucide/message.png', title: '消息中心', desc: '站内消息与微信订阅设置', url: '/pages/my/message', tone: 'butter' },
          { icon: '/assets/icons/lucide/support.png', title: '专属支持', desc: '常见问题、客服与反馈进度', url: '/pages/my/support', tone: 'coral' }
        ]
      },
      {
        title: '账号与关于',
        items: [
          { icon: '/assets/icons/lucide/account.png', title: '我的账号', desc: '账号、隐私与儿童信息管理', url: '/pages/my/account', tone: 'lavender' },
          { icon: '/assets/icons/lucide/about.png', title: '关于我们', desc: '版本、协议与意见反馈', url: '/pages/my/about', tone: 'neutral' }
        ]
      }
    ]
  },
  onShow() {
    this.__disposed = false
    util.setTab(3)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    this.reload()
  },
  reload() {
    const version = util.beginRequest(this, 'my')
    this.setData({ loading: true, error: '' })
    Promise.all([api.getParent(), api.getChildren(), api.getFamily(), api.getDevices()]).then(([parent, children, family, devices]) => {
      if (!util.isRequestCurrent(this, 'my', version)) return
      const currentId = require('../../services/store').getCurrentChildId()
      const child = children.find((item) => item.id === currentId) || children[0] || {}
      const device = devices.find((item) => item.id === child.deviceId) || {}
      this.setData({ parent, children, family, child, device, loading: false, error: '' })
    }).catch((e) => {
      if (!util.isRequestCurrent(this, 'my', version)) return
      util.failToast(e)
      this.setData({ loading: false, error: (e && e.message) || '账号信息加载失败' })
    })
  },
  openSwitcher() { this.setData({ showSwitcher: true }) },
  closeSwitcher() { this.setData({ showSwitcher: false }) },
  onChildChange() {
    this.setData({ loading: true, child: {}, device: {} })
    this.reload()
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) },
  onUnload() { util.disposePage(this) }
})
