const api = require('../../services/api')
const util = require('../../utils/util')
const instructions = {
  g1: ['先在家庭管理中确认当前孩子。', '在绑定页输入演示码 222222（小满）或 333333（星河）；确认姓名后等待绑定结果。', '设备中心查看所属孩子；重新绑定设备不会创建新的孩子。'],
  g2: ['进入守护页，先确认当前孩子和设备。', '查看更新时间、精度及在线状态；点击刷新获取一条新的模拟位置。', '设备离线或点位失效时不会保留旧坐标。当前不提供历史轨迹。'],
  g3: ['确认设备在线，进入语音通话并点击呼叫。', '依次体验等待接听、接通、通话计时和挂断；静音、扬声器等开关会保留当前选择。', '此处为通话流程模拟，不采集声音。拒接、占线或超时后可再次尝试。'],
  g4: ['在通讯录新增姓名及手机号，保存前会校验。', '在紧急联系人中选择已有联系人，并按需要调整联系顺序。', '离线时先保存配置并显示待同步，不能将其视为设备已确认。'],
  g5: ['确认设备在线后点击“确认响铃查找”。', '指令受理后进入响铃状态，并持续显示剩余时间。', '点击“手动停止响铃”结束任务；到时自动停止。当前设备不会实际响铃。']
}
Page({
  data: { list: [], loading: true, error: '', expanded: '' },
  onShow() {
    this.reload()
  },
  reload() { return util.loadPage(this, () => api.getGuide(), (list) => ({ list: list.map((item) => Object.assign({}, item, { steps: instructions[item.id] || ['进入功能页，根据状态提示继续操作。'] })) })) },
  toggle(e) { const id = e.currentTarget.dataset.id; util.safeSetData(this, { expanded: this.data.expanded === id ? '' : id }) },
  onUnload() { util.disposePage(this) },
  open(e) {
    const url = e.currentTarget.dataset.url
    util.navigate(url)
  }
})
