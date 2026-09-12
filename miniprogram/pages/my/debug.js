const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { current: 'default', childName: '', courseId: 'B04', busy: false, lastResult: '', list: [
    {id:'default',name:'正常：设备在线、数据完整'},
    {id:'empty',name:'数据不足：未知而非零分'}, {id:'loading',name:'请求响应较慢'},
    {id:'device-offline',name:'设备离线：配置等待同步'}, {id:'stale',name:'位置过期：清除地图坐标'},
    {id:'offline',name:'请求失败：明确重试入口'}, {id:'call-busy',name:'设备忙 / 通话占线'},
    {id:'call-rejected',name:'通话被拒绝'}, {id:'call-interrupted',name:'接通后通话中断'}, {id:'timeout',name:'超时：查询最终结果'},
    {id:'fail',name:'设备执行失败'}, {id:'device-online',name:'设备恢复在线并同步配置'}, {id:'generating',name:'报告生成中'}
  ]},
  onShow() { this.reload() },
  reload() { return api.getContext().then((ctx) => util.safeSetData(this, { current: ctx.scenario, childName: ctx.child ? ctx.child.name : '未绑定' })).catch(util.failToast) },
  async pick(e) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try { await api.setDemoScenario(e.currentTarget.dataset.id); await this.reload(); util.toast('场景已切换，返回对应页面查看') }
    catch(e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy:false }) }
  },
  input(e) { this.setData({ courseId: e.detail.value.toUpperCase().trim() }) },
  async inject() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      const r = await api.injectDemoEvent({ type:'course-completed', courseId:this.data.courseId, id:'manual-complete-'+this.data.courseId })
      util.safeSetData(this, { lastResult: r.duplicate ? '此完成记录已存在，覆盖不会重复增加' : '记录已加入：返回首页和成长查看变化；历史报告需重新生成' })
    } catch(e) { util.failToast(e) }
    finally { util.safeSetData(this, { busy:false }) }
  },
  async reset() {
    if (!await util.confirm('重置本地示例', '将清除本机示例操作并恢复示例家庭，旧任务全部失效，不影响真实后台。')) return
    await api.resetDemo().then(() => this.reload()).then(() => util.safeSetData(this, { lastResult:'已重置' })).catch(util.failToast)
  },
  onUnload() { util.disposePage(this) }
})
