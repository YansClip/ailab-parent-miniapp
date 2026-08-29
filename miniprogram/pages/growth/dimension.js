const api = require('../../services/api')
const util = require('../../utils/util')

const DIMENSION_COPY = {
  observe: { summary: '能留意现象里的细节，并主动比较变化。', evidence: ['在声音波形互动中发现频率差异', '记录现象后会再次核对自己的判断'], suggestion: '陪孩子描述“看见了什么、哪里不一样”，先听完整再追问。' },
  express: { summary: '愿意用自己的语言说明发现和理由。', evidence: ['能完整讲述火箭改变方向的原因', '表达中开始使用更清楚的先后关系'], suggestion: '请孩子用一句话先说结论，再补充一个支持结论的证据。' },
  collab: { summary: '在共同任务中逐步形成分工和回应意识。', evidence: ['项目协作时能回应同伴的建议', '遇到分歧后愿意重新调整方案'], suggestion: '家庭项目中给孩子一个明确角色，并在结束后复盘彼此如何配合。' },
  explore: { summary: '会继续追问，并尝试通过行动验证想法。', evidence: ['围绕推进方向连续追问 3 次', '提出猜想后主动寻找可验证的方法'], suggestion: '少给直接答案，多问一句“你准备怎样验证这个想法”。' },
  create: { summary: '正在积累形成原创方案所需的有效记录。', evidence: [], suggestion: '提供开放材料和足够时间，鼓励孩子先做出一个可以被讨论的版本。' },
  persist: { summary: '遇到暂时失败时，愿意调整方法继续完成。', evidence: ['设备调试失败后尝试了另一种连接顺序', '能够把较长任务拆成几个小步骤'], suggestion: '认可具体的坚持过程，例如“你换了方法以后又试了一次”。' }
}

Page({
  data: { dim: {}, detail: {} },
  onLoad(q) {
    api.getGrowth().then((g) => {
      const dim = (g.dimensions || []).find((d) => d.key === q.key) || (g.dimensions || [])[0] || {}
      this.setData({ dim, detail: DIMENSION_COPY[dim.key] || DIMENSION_COPY.observe })
    }).catch((e) => util.failToast(e))
  }
})
