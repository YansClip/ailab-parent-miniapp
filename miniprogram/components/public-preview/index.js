const access = require('../../services/access')
const content = require('../../services/public-content')
Component({
  properties: {
    section: { type: String, value: 'home' },
    signedIn: { type: Boolean, value: false },
    statusBarHeight: { type: Number, value: 44 }
  },
  data: { sections: content.sections, notes: content.notes, dimensions: content.dimensions, expanded: '', tool: '', dimension: '' },
  methods: {
    toggle(e) { const id = e.currentTarget.dataset.id; this.setData({ expanded: this.data.expanded === id ? '' : id }) },
    showTool(e) { const id = e.currentTarget.dataset.id; this.setData({ tool: this.data.tool === id ? '' : id }) },
    showDimension(e) { const id = e.currentTarget.dataset.id; this.setData({ dimension: this.data.dimension === id ? '' : id }) },
    login() { access.requestLogin(this.data.section) },
    guide() { wx.navigateTo({ url: '/pages/my/guide' }) },
    about() { wx.navigateTo({ url: '/pages/my/about' }) },
    policy(e) { wx.navigateTo({ url: '/pages/my/policy?type=' + e.currentTarget.dataset.type }) }
  }
})
