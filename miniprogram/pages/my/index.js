const api = require('../../services/api')
const util = require('../../utils/util')
const store = require('../../services/store')

Page({
  data: {
    statusBarHeight: 44,
    parent: {},
    childName: '林小满',
    menus: [
      { title: '家庭管理', desc: '成员、邀请与主管理员', url: '/pages/my/family', color: '#8b78e6' },
      { title: '设备中心', desc: '在线、电量与解绑', url: '/pages/my/device', color: '#40b352' },
      { title: '玩机指南', desc: '绑定、守护与五项工具', url: '/pages/my/guide', color: '#68b8f7' },
      { title: '消息中心', desc: '家庭、守护、成长与系统', url: '/pages/my/message', color: '#f2a84a' },
      { title: '专属支持', desc: '客服、反馈与服务进度', url: '/pages/my/support', color: '#1ac7cc' },
      { title: '我的账号', desc: '隐私、儿童信息与注销', url: '/pages/my/account', color: '#e85d69' },
      { title: '关于我们', desc: '版本、协议与意见反馈', url: '/pages/my/about', color: '#829ab1' }
    ]
  },
  onShow() {
    util.setTab(3)
    if (!util.guardAuth()) return
    this.setData({ statusBarHeight: util.statusBarHeight() })
    api.getParent().then((parent) => {
      const id = store.getCurrentChildId()
      this.setData({ parent, childName: id === 'child-xinghe' ? '陈星河' : '林小满' })
    }).catch((e) => util.failToast(e))
  },
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) }
})
