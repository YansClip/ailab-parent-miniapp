// Editorial examples only. No store, mock database, location or account APIs.
const guides = [
  { id: 'g1', title: '绑定 Mini 设备', desc: '建立家庭、孩子与设备之间的关系', url: '/pages/family/bind', steps: ['主动登录后创建或加入家庭。', '输入设备提供的绑定码，核对孩子与设备。', '等待绑定结果确认，不把提交成功当作绑定完成。'] },
  { id: 'g2', title: '实时守护', desc: '查看当前位置、采集时间与有效性', url: '/pages/guard/index', steps: ['进入守护，确认当前孩子与设备。', '查看位置采集时间和精度，按需刷新。', '离线或位置过期时不展示旧坐标，不保存历史轨迹。'] },
  { id: 'g3', title: '语音与视频通话', desc: '联系孩子，查看接听与结束状态', url: '/pages/guard/call', steps: ['登录并确认设备具备对应通话能力。', '主动发起呼叫，等待孩子接听；创建会话不代表接通。', '拒接、占线或失败时查看原因；挂断后确认会话结束。真实媒体需要设备和平台能力接入。'] },
  { id: 'g4', title: '联系人与紧急联系人', desc: '管理可联系的人及紧急联系顺序', url: '/pages/guard/contacts', steps: ['由有权限的监护人管理通讯录。', '选择紧急联系人并调整联系顺序。', '配置保存与设备同步分别确认；离线时显示等待同步。'] },
  { id: 'g5', title: '查找设备', desc: '发起响铃并手动停止', url: '/pages/guard/find', steps: ['确认当前设备并主动发起查找。', '等待设备确认后显示响铃状态。', '找到后停止响铃；失败或超时不提示已经找到。'] }
]
const sections = {
  home: { title: '陪伴每一次好奇', intro: '先看看孩子的发现如何变成家长可读的卡片。以下均为公开示例，与您的家庭无关。' },
  guard: { title: '安心守护', intro: '了解当前位置、音视频通话和设备工具如何使用。这里不获取位置、不访问设备，也不采集音视频。' },
  growth: { title: '看见成长', intro: '从提问、探索记录到成长启思简报，了解成长页面。以下是说明性示例，不代表任何孩子的真实数据。' },
  my: { title: '陪伴，也照顾到你', intro: '使用指南、产品说明和协议可直接阅读；本人家庭、消息及账号管理需要登录后使用。' }
}
const notes = [
  { id: 'question', label: '好奇提问 · 示例', title: '为什么轻轻触摸也能让机器人回应？', summary: '一次关于触摸与传感器的观察，变成一张值得一起聊聊的卡片。', image: '/assets/island/robot-island.jpg', detail: '示例记录：分别尝试轻触、靠近和长按，观察回应是否相同。家长可以问：你发现了哪些不同？还想怎样验证？这段文字为公开示例，不来自家庭数据。' },
  { id: 'result', label: '探索成果 · 示例', title: '把听到的声音，变成看得见的波形', summary: '成果卡片保留探索过程与记录，方便家长回看，不增加上传或学习入口。', image: '/assets/illustrations/result-sound-v2.jpg', detail: '示例说明：通过波形观察大小不同的声音。正式卡片由孩子使用记录产生，不按每天固定条数推送；只读查看，不代表已经完成某项能力评估。' }
]
const dimensions = ['系统认知', '数据与感知', '网络与控制', 'AI理解', '工程创造', '人本安全'].map((name, i) => ({ id: String(i), name, detail: '这一维度汇总与「' + name + '」相关内容的探索完成记录。覆盖率＝已完成相关内容数÷相关内容总数；重复完成不重复计数，缺少数据时显示未知，不评价孩子能力高低。' }))
function getGuide() { return guides.map(item => ({ ...item, status: '使用说明', steps: item.steps.slice() })) }
module.exports = { sections, notes, dimensions, getGuide }
