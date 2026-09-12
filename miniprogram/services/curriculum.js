/** Source: V3.1 正式版 / 31课节点表.csv + 31课_六维能力覆盖矩阵.csv.
 * Coverage is curriculum participation, never a learner ability assessment.
 * demo-level-* are local demo mappings, not production Web identifiers.
 */
const dimensions = [["system","系统认知"],["data","数据与感知"],["control","网络与控制"],["ai","AI理解"],["engineering","工程创造"],["safety","人本安全"]].map(([key, name]) => ({ key, name }))
const courses = [
  {
    "id": "B01",
    "title": "机器人不是零件堆：认识完整系统",
    "module": "基础：能量与信息",
    "prerequisites": [],
    "coverage": [
      3,
      0,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "提交一张正确的系统框图并用一句话解释。",
    "webLevelId": "demo-level-B01"
  },
  {
    "id": "B02",
    "title": "能量从哪里来：电源、功耗与安全",
    "module": "基础：能量与信息",
    "prerequisites": [
      "B01"
    ],
    "coverage": [
      1,
      0,
      0,
      0,
      1,
      3
    ],
    "expectedEvidence": "正确标注能量流并给出安全理由。",
    "webLevelId": "demo-level-B02"
  },
  {
    "id": "B03",
    "title": "从世界到数据：现象、信号、采样与编码",
    "module": "基础：能量与信息",
    "prerequisites": [
      "B01"
    ],
    "coverage": [
      3,
      3,
      0,
      0,
      1,
      1
    ],
    "expectedEvidence": "三案例四层归类正确率达到 80% 以上。",
    "webLevelId": "demo-level-B03"
  },
  {
    "id": "B04",
    "title": "让系统可控：规则、状态、反馈与失效安全",
    "module": "基础：能量与信息",
    "prerequisites": [
      "B01",
      "B02",
      "B03"
    ],
    "coverage": [
      3,
      3,
      0,
      0,
      1,
      3
    ],
    "expectedEvidence": "完成一份闭环与安全态判定表。",
    "webLevelId": "demo-level-B04"
  },
  {
    "id": "S01",
    "title": "摸一下发生了什么：电容触摸与阈值",
    "module": "感知：传感器",
    "prerequisites": [
      "B03"
    ],
    "coverage": [
      1,
      3,
      0,
      3,
      1,
      1
    ],
    "expectedEvidence": "给出阈值选择及误触/漏触理由。",
    "webLevelId": "demo-level-S01"
  },
  {
    "id": "S02",
    "title": "空气也有数据：温湿度与 AHT20-F",
    "module": "感知：传感器",
    "prerequisites": [
      "B03",
      "S01"
    ],
    "coverage": [
      1,
      3,
      0,
      0,
      1,
      1
    ],
    "expectedEvidence": "正确解释一条带单位、时间与容差的温湿度记录。",
    "webLevelId": "demo-level-S02"
  },
  {
    "id": "S03",
    "title": "看不见的尺子：红外、距离与边缘",
    "module": "感知：传感器",
    "prerequisites": [
      "B03",
      "S02"
    ],
    "coverage": [
      1,
      3,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "完成一份两场景阈值与失效条件说明。",
    "webLevelId": "demo-level-S03"
  },
  {
    "id": "S04",
    "title": "机器人知道自己在动：加速度、角速度与姿态",
    "module": "感知：传感器",
    "prerequisites": [
      "B03",
      "S03"
    ],
    "coverage": [
      1,
      3,
      3,
      0,
      1,
      1
    ],
    "expectedEvidence": "完成动作分类并解释至少一个可能误判。",
    "webLevelId": "demo-level-S04"
  },
  {
    "id": "S05",
    "title": "声音如何进入机器人：声波、麦克风与采样",
    "module": "感知：传感器",
    "prerequisites": [
      "B03",
      "S04"
    ],
    "coverage": [
      1,
      3,
      0,
      3,
      1,
      1
    ],
    "expectedEvidence": "正确画出语音进入 ASR 前的信号链。",
    "webLevelId": "demo-level-S05"
  },
  {
    "id": "S06",
    "title": "传感器也会犯错：校准、滤波与多传感融合",
    "module": "感知：传感器",
    "prerequisites": [
      "S01",
      "S02",
      "S03",
      "S04",
      "S05"
    ],
    "coverage": [
      1,
      3,
      0,
      0,
      1,
      3
    ],
    "expectedEvidence": "提交一张“数据问题—处理—代价”表。",
    "webLevelId": "demo-level-S06"
  },
  {
    "id": "T01",
    "title": "主控在做什么：ESP32 的角色与时间尺度",
    "module": "传输与控制",
    "prerequisites": [
      "B03",
      "B04"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      1,
      3
    ],
    "expectedEvidence": "任务分配表无安全关键项上云等待。",
    "webLevelId": "demo-level-T01"
  },
  {
    "id": "T02",
    "title": "信息怎样走线：GPIO、I²C、I²S、PWM 与编码器",
    "module": "传输与控制",
    "prerequisites": [
      "T01",
      "S01",
      "S02",
      "S05"
    ],
    "coverage": [
      1,
      0,
      3,
      0,
      1,
      3
    ],
    "expectedEvidence": "接口匹配正确率 80% 以上且无电气安全错误。",
    "webLevelId": "demo-level-T02"
  },
  {
    "id": "T03",
    "title": "从机器人到网页：Wi‑Fi、WebSocket 与 MQTT",
    "module": "传输与控制",
    "prerequisites": [
      "T01",
      "T02"
    ],
    "coverage": [
      1,
      0,
      3,
      0,
      1,
      1
    ],
    "expectedEvidence": "完成一张双向消息地图。",
    "webLevelId": "demo-level-T03"
  },
  {
    "id": "T04",
    "title": "指令不等于结果：状态、ACK、超时与离线",
    "module": "传输与控制",
    "prerequisites": [
      "B04",
      "T03"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      3,
      1
    ],
    "expectedEvidence": "正确重建一条包含失败分支的状态序列。",
    "webLevelId": "demo-level-T04"
  },
  {
    "id": "A01",
    "title": "它什么时候开始听：VAD 与唤醒词",
    "module": "理解与决策：AI",
    "prerequisites": [
      "S05",
      "T01"
    ],
    "coverage": [
      1,
      0,
      0,
      3,
      1,
      1
    ],
    "expectedEvidence": "正确区分四种检测结果。",
    "webLevelId": "demo-level-A01"
  },
  {
    "id": "A02",
    "title": "听见不等于听懂：自动语音识别 ASR",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A01",
      "T03"
    ],
    "coverage": [
      1,
      0,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "完成一份识别错误原因分类。",
    "webLevelId": "demo-level-A02"
  },
  {
    "id": "A03",
    "title": "谁在说，而不是说了什么：声纹与身份边界",
    "module": "理解与决策：AI",
    "prerequisites": [
      "S05",
      "A02"
    ],
    "coverage": [
      1,
      0,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "完成 ASR/声纹/唤醒三列辨析表。",
    "webLevelId": "demo-level-A03"
  },
  {
    "id": "A04",
    "title": "一句话怎样变成动作：意图、参数与指令集",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A02",
      "B04"
    ],
    "coverage": [
      1,
      0,
      3,
      3,
      1,
      1
    ],
    "expectedEvidence": "决策表中危险请求无直接执行。",
    "webLevelId": "demo-level-A04"
  },
  {
    "id": "A05",
    "title": "大模型会生成什么：模式、上下文与边界",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A04"
    ],
    "coverage": [
      1,
      0,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "完成一张四级输出审核表。",
    "webLevelId": "demo-level-A05"
  },
  {
    "id": "A06",
    "title": "让回答有出处：知识库、检索与 RAG",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A05"
    ],
    "coverage": [
      1,
      0,
      0,
      3,
      1,
      1
    ],
    "expectedEvidence": "回答包含匹配来源并正确处理一条冲突。",
    "webLevelId": "demo-level-A06"
  },
  {
    "id": "A07",
    "title": "文字怎样变成声音：TTS、韵律与音色",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A02",
      "A05"
    ],
    "coverage": [
      1,
      3,
      0,
      3,
      1,
      1
    ],
    "expectedEvidence": "完成内容/韵律/音色三层标注。",
    "webLevelId": "demo-level-A07"
  },
  {
    "id": "A08",
    "title": "AI 何时该停下来：隐私、不确定性与人工接管",
    "module": "理解与决策：AI",
    "prerequisites": [
      "A03",
      "A04",
      "A05",
      "A06",
      "A07",
      "B04"
    ],
    "coverage": [
      1,
      3,
      0,
      3,
      1,
      3
    ],
    "expectedEvidence": "风险表覆盖数据、模型、动作和故障四类。",
    "webLevelId": "demo-level-A08"
  },
  {
    "id": "E01",
    "title": "一块屏幕如何表达状态：像素、界面与情绪",
    "module": "执行与反馈",
    "prerequisites": [
      "T01",
      "B04"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      3,
      3
    ],
    "expectedEvidence": "状态卡与画面一一对应且无安全歧义。",
    "webLevelId": "demo-level-E01"
  },
  {
    "id": "E02",
    "title": "从数字音频到空气振动：功放、扬声器与可懂度",
    "module": "执行与反馈",
    "prerequisites": [
      "A07",
      "B02"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      1,
      3
    ],
    "expectedEvidence": "给出一套兼顾可懂度、功耗与听力安全的设置。",
    "webLevelId": "demo-level-E02"
  },
  {
    "id": "E03",
    "title": "转起来还是转到位：直流电机、舵机与驱动",
    "module": "执行与反馈",
    "prerequisites": [
      "B02",
      "T02"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      1,
      1
    ],
    "expectedEvidence": "匹配正确并指出一项机械/电气限制。",
    "webLevelId": "demo-level-E03"
  },
  {
    "id": "E04",
    "title": "知道转了多少：编码器、速度与位置闭环",
    "module": "执行与反馈",
    "prerequisites": [
      "B04",
      "E03"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      1,
      3
    ],
    "expectedEvidence": "闭环图完整并能指出打滑风险。",
    "webLevelId": "demo-level-E04"
  },
  {
    "id": "E05",
    "title": "会动还要安全：模块、关节、限位与动作序列",
    "module": "执行与反馈",
    "prerequisites": [
      "E03",
      "E04",
      "B04"
    ],
    "coverage": [
      3,
      0,
      3,
      0,
      1,
      3
    ],
    "expectedEvidence": "动作卡包含限位、停止和失败反馈。",
    "webLevelId": "demo-level-E05"
  },
  {
    "id": "E06",
    "title": "让人看懂机器人：屏幕、声音、动作与状态一致",
    "module": "执行与反馈",
    "prerequisites": [
      "E01",
      "E02",
      "E05",
      "T04"
    ],
    "coverage": [
      3,
      3,
      3,
      0,
      3,
      3
    ],
    "expectedEvidence": "五状态反馈表无矛盾且含恢复路径。",
    "webLevelId": "demo-level-E06"
  },
  {
    "id": "C01",
    "title": "10–12 岁｜会感知、会回应的机器人伙伴",
    "module": "创造：综合任务",
    "prerequisites": [
      "B04",
      "S01",
      "A01",
      "A02",
      "A04",
      "A07",
      "E01",
      "E02",
      "E03",
      "E06"
    ],
    "coverage": [
      3,
      3,
      2,
      2,
      3,
      3
    ],
    "expectedEvidence": "提交一张闭环图、三次测试记录和一次改进。",
    "webLevelId": "demo-level-C01"
  },
  {
    "id": "C02",
    "title": "13–15 岁｜环境守护与安全机器人",
    "module": "创造：综合任务",
    "prerequisites": [
      "B04",
      "S02",
      "S03",
      "S04",
      "S06",
      "T04",
      "A04",
      "A08",
      "E01",
      "E02",
      "E04",
      "E06"
    ],
    "coverage": [
      3,
      3,
      2,
      2,
      3,
      3
    ],
    "expectedEvidence": "提交需求、规则、测试矩阵、改进记录和残余风险。",
    "webLevelId": "demo-level-C02"
  },
  {
    "id": "C03",
    "title": "16–18 岁｜有边界的个性化知识伙伴",
    "module": "创造：综合任务",
    "prerequisites": [
      "T04",
      "A02",
      "A03",
      "A04",
      "A05",
      "A06",
      "A07",
      "A08",
      "E06"
    ],
    "coverage": [
      3,
      3,
      2,
      3,
      3,
      3
    ],
    "expectedEvidence": "提交系统设计、来源示例、隐私边界、测试与未决风险。",
    "webLevelId": "demo-level-C03"
  }
]
const versions = { ruleVersion: 'coverage-v1', curriculumVersion: 'V3.1', mappingVersion: 'demo-v1' }
function planFor(age) {
  const capstone = age <= 12 ? 'C01' : age <= 15 ? 'C02' : 'C03'
  return courses.filter((course) => course.id[0] !== 'C' || course.id === capstone)
}
module.exports = { dimensions, courses, versions, planFor }

