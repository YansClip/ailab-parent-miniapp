# V3 真实服务替换与联调约定

本文面向 SaaS、设备云、家庭后台及小程序交付方，依据 2026-09-12 当前代码。它区分“本地已经呈现的业务契约”和“真实接入仍需完成的工作”，不是上线证明、法律合规结论或全真机验收报告。

## 1. 先确定三个数据真源

当前页面统一调用 `miniprogram/services/api.js`，该文件主要转发到 `mock.js`；业务状态保存在微信本机 storage。后续优先替换这一边界，不让页面直接连接数据库、写设备状态或依赖 mock。

| 数据责任方 | 应成为真实来源的数据 | 当前本地替代 | 接入不能省略的确认 |
|---|---|---|---|
| Web SaaS / 内容与探索服务 | 正式内容目录、孩子的探索计划、解锁/完成事件、提问与验证记录、成果证据、成长汇总与报告快照 | `curriculum.js` 的 V3.1 内容映射；预置事件；`injectDemoEvent`；本地汇总和快照 | 哪个系统认定完成、重复事件口径、正式 Web 关卡 ID、事件更正/撤销、目录及报告版本 |
| 设备云 / 设备控制服务 | 设备身份与在线状态、电量/固件、定位时效、通话会话、查找响铃、联系人/闹钟/SOS 配置应用结果 | 固定设备、固定位置点、时间驱动会话、`synced` 标志 | 指令 ID、设备 ACK、最终执行状态、离线队列、超时查询、设备时钟与云端接收时间 |
| 账号与家庭后台 | 微信身份换取、家长账号、家庭/孩子/设备绑定关系、成员角色与权限、邀请、同意记录、儿童资料与隐私请求 | 本地 session、两名示例孩子、一次性测试码、主管理员/普通成员判定 | 真实监护关系核验、服务端鉴权、绑定码签发与占用、权限变更生效、解绑/删除/撤回/注销责任 |

通知投递、客服工单、图片存储和分享服务的责任方需另行明确。当前订阅开关只是本地布尔值；反馈只是本机记录，不代表已发出微信提醒或已发送客服。

小程序负责界面、用户确认、表单校验、缓存和状态呈现；**不能以客户端自报的 `role`、`childId` 或 `familyId` 作为最终授权依据**。

## 2. 探索目录、Web 映射与六维口径

正式内容标题、编号和六维内容覆盖矩阵来自当前 V3.1 目录。家长端用“探索内容/探索记录”呈现；它不是孩子端课程播放器，不新增游戏、闯关、商城、徽章或排行榜。

| 规则 | 当前实现与接入要求 |
|---|---|
| 总目录 | 31 项：28 项非综合任务，加 C01/C02/C03 三个年龄向综合任务 |
| 当前两个孩子的计划 | 11 岁保留 C01，14 岁保留 C02；分别为 **28 + 1 = 29 项**，不能把分母用成全目录 31 |
| 其他年龄 | 当前函数 `age<=12→C01`、`age<=15→C02`、其余 C03；这只是本地选择规则，不代表 6–9 岁内容方案或跨年龄迁移已经定稿 |
| 完成数 | 只统计本计划内的 `course-completed`，按孩子和内容编号的首次完成去重；解锁、提问、成果事件均不直接增加完成数 |
| 六维覆盖 | 该维度首次完成内容数 ÷ 该维度映射内容总数；百分比四舍五入。矩阵的 1/2/3 用来识别内容关联，目前只按大于 0 计入，不加权成为能力分 |
| 近 7 天变化 | 整体 `progress.delta` 为近 7 天首次完成数量；维度 `delta` 为同一分母下的新增覆盖百分点，不能写成“能力提高 X 分” |
| 不足与已知零 | 没有事件记录时可标 `insufficient`；已有明确记录且相关内容完成数为零时可以显示 0% 覆盖。当前不足判断只是本地数据可用性规则，不是经过验证的能力或证据充分性标准 |
| 证据 | `evidence` 可追溯到事件 ID、日期、内容编号和来源。课程 `expectedEvidence` 是成果要求，不是已经核验的学生作品 |

六维 key 与当前每个年龄计划的相关分母：

| key | 家长端名称 | 相关内容总数 |
|---|---|---:|
| `system` | 系统认知 | 29 |
| `data` | 数据与感知 | 12 |
| `control` | 网络与控制 | 13 |
| `ai` | AI 理解 | 13 |
| `engineering` | 工程创造 | 29 |
| `safety` | 人本安全 | 29 |

当前版本字段为 `ruleVersion: coverage-v1`、`curriculumVersion: V3.1`、`mappingVersion: demo-v1`。`demo-level-B04` 这类 `webLevelId` **仅为本地占位映射**，不可当成正式 Web 关卡编号直接上线。

真实接入前，应由 SaaS 方给出稳定的 `courseId ↔ webLevelId` 对照和变更版本，确认计划是否按孩子固定、年龄增长时是否迁移、历史完成是否沿用、目录变更后的旧报告如何解释。若某维度没有相关内容，必须定义零分母表现，不能直接除零。

## 3. 页面当前调用的接口

以下为 JavaScript 门面方法，不是已经部署的 HTTP 路径。多数读写方法隐式使用本地“当前孩子”；真实接口应在协议中明确业务范围，由服务端校验该范围属于当前登录家长。

| 场景 | 当前方法及参数 | 核心返回/约束 |
|---|---|---|
| 隐私与登录 | `acceptPrivacy()`、`login()` | 当前仅本地同意与 `wx.login` code 成功检查；需替换为后端身份交换、会话及同意记录 |
| 上下文 | `getContext()`、`getParent()`、`getChildren()` | 当前孩子/设备/家庭/家长 ID、角色、权限、epoch、版本字段；孩子列表是授权范围而非全站列表 |
| 创建/绑定 | `createFamily({name,relation})`、`bindChild({code})`、`completeBind(taskId)` | 返回异步任务；只有当前会话的成功绑定任务可完成进入；测试码由真实一次性码替换 |
| 首页与消息 | `getHome()`、`getMessages()`、`markMessageRead(id)` | 摘要、动态、待办都应可回到有效来源；处理后重读；消息已读按孩子范围保存 |
| 兴趣足迹 | `getFootprint(id)`、`toggleFootprintFollow(id)` | 当前孩子的事件详情；关注返回 `{id,followed}`；未知或跨孩子目标不能回退为默认记录 |
| 成长汇总 | `getGrowth()`、`getGrowthDimension(key)` | progress、plan、dimensions、brief、briefHistory、reports、achievements；维度含 completed/total/value/delta/insufficient/evidence |
| 报告与成果 | `getReport(id)`、`regenerateReport(id)`、`getAchievement(id)` | 目前报告 ID 为 `w1/p1`；真实服务需稳定报告 ID、所属孩子、生成周期和快照版本 |
| 分享预览 | `getSharePreview({targetType,targetId,childId})` | 类型仅 `report/achievement`；返回匹配目标的标题、别名、正文、范围、隐藏项、状态与 canShare |
| 定位/设备 | `getLocation()`、`refreshLocation()`、`getDevices()` | 有效/离线/过期/未绑定明确区分；无效时 point 为空，不复用旧坐标 |
| 联系人 | `getContacts()`、`getContact(id)`、`saveContact({id?,name,relation,phone,deviceCall})` | 写入返回任务；SOS 引用中的联系人不可直接删除或关闭设备通话 |
| 闹钟 | `getAlarms()`、`getAlarm(id)`；`submitTask('alarm-save',{id?,time,label,repeat,enabled})` | HH:mm、名称、重复规则、开关；设备应用结果与配置保存分开 |
| SOS | `getSos()`、`saveSos(ids)` | 1–3 名不同的、已开启设备通话的联系人；顺序需要保留 |
| 通话 | `startCall()`、`getCallSession()`、`updateCallControl(control,value)`、`endCall(reason)` | control 为 muted/speaker/nr；当前只改本地会话标志，未连接真实音频 |
| 查找设备 | `startFinding()`、`getFindSession()`、`stopFinding(reason)` | 同一孩子复用活动会话，最长 60 秒；当前没有真实设备响铃 |
| 家庭管理 | `getFamily()`、`acceptInvite(id)`、`rejectInvite(id)` | 邀请须待处理，转移目标须已加入；写入通过任务执行 |
| 隐私/客服/提醒 | `getPrivacyRequest(type)`、`getSubscription()`、`getFeedbacks()`；相应 submitTask | 现为本地记录；正式接入需真实处理凭证、责任方、保留/删除策略和送达反馈 |

通用任务方法为 `submitTask(type,payload)` / `getTask(id)`。需保留的 payload 契约包括：

| type | payload |
|---|---|
| `contact-delete` / `alarm-delete` | `{id}` |
| `child-unbind` / `device-unbind` | `{id}`，分别为孩子 ID / 设备 ID |
| `device-bind` | `{id}`，当前仅恢复家庭已有的设备；新设备仍走绑定码 |
| `admin-transfer` | `{memberId}` |
| `child-data-request` | `{action:'view'}` 或 `{action:'correct',name,note?}` |
| `data-delete` / `consent-withdraw` / `account-cancel` | `{}`，当前范围来自会话；真实协议必须明确对象与影响范围 |
| `subscription-update` | `{enabled}` |
| `feedback` | `{text}`（兼容 content） |
| `report-regen` | `{id}`，建议页面继续用 regenerateReport |

测试专用 `setDemoScenario`、`resetDemo`、`injectDemoEvent` 不应进入生产权限域。真实 Web 事件接入应是经过鉴权的服务间写入，不能允许家长端随意声明孩子“已完成”。

## 4. 权限与主体隔离

当前模拟服务在提交任务和真正变更数据时均核对角色及对象，页面也隐藏或禁用无权限操作。后续必须保留双层校验，并将最终判断迁到服务端。

- 主管理员：创建/绑定、成员与设备关系、联系人/闹钟/SOS 配置、儿童资料查看更正、删除数据、撤回同意等管理写入。
- 普通成员：当前可查看授权孩子的成长、使用已绑定在线设备的通话/查找、生成报告；不能因页面按钮可见就跳过服务授权。
- 当前账号注销不等于删除其他成员的有效资料。正式账号注销的前置检查、管理员移交要求和家庭关系处理需由账号后台确认；当前本地提示不等于服务端已完整执行这些规则。
- 服务端必须核对 parent/family/child/device 的真实关系；不能接受客户端伪造 ID 或靠 ID 难以猜到保护对象。
- 本地 `epoch + currentChildId` 与请求版本用来阻止切孩子、退出、撤回后的旧回包继续更新页面。它们是客户端安全防线，不是后端 token 撤销或 ACL 的替代品。
- 表单打开后发生权限变化、孩子切换或设备解绑，提交时应重新校验。可查询旧任务最终回执的范围需要严格限定，不能借“恢复查询”读取其他家庭任务。

## 5. 异步任务、设备 ACK 与幂等

当前任务至少包含 `id/type/payload/status/createdAt/parentId/familyId/childId/deviceId/epoch`；结果可包含 `synced/result/errorCode/message/finishedAt`。

```text
submitted → executing → success / failed
                     → timeout → 继续查询最终状态
会话或权限失效       → cancelled
未找到任务           → unknown
```

当前约 0.5 秒开始执行、1.8 秒出结果；timeout 示例约 5 秒后仍可能成功。时间仅用于本地演示。状态由后续接口查询推进，不是已部署的消息队列、设备应答或后台作业。

真实接入必须区分：

1. 请求被服务接收：只允许显示已提交。
2. 配置被云端保存：离线设备可处于待同步，不显示设备已应用。
3. 设备 ACK 与执行结果：分别确认接收/应用/失败。服务器自己的 success 不能代替设备 ACK。
4. 等待超时：先用原 commandId/taskId 查询最终结果，不能立刻假定失败并重复执行。
5. 用户停止或解绑：停止通话、停止响铃等需要最终确认；本地按钮变色不是设备停止的证明。

需要新增真实的 requestId/idempotencyKey、命令 ID、序列/版本、重试期限、过期与撤销规则。当前本地活动任务按类型和 payload 复用不能当作生产幂等保障；尤其新建联系人/闹钟会先分配本地 ID。

通话现有状态为 calling/connected/rejected/busy/timeout/failed/interrupted/ended；查找状态为 ringing/stopped/expired。真实音频、扬声器、静音、降噪和设备铃声能力要由对应 SDK/设备协议确认，不沿用模拟成功假设。

## 6. 报告快照与成果依据

当前 ready 报告保存生成时的快照，包含 `cutoffAt/sourceEvents/sourceEventIds/progress/dimensions`、规则版本、生成时间和报告版本。新增事件不会直接改写旧快照；重新生成成功后形成新版本，页面随后重新读取报告。

周报的代表事件限定在截止时刻前 7 天；其探索完成数/六维覆盖是截至生成时的累计值，不是“本周完成总量”。必须明确展示这一区别。近 7 天新增数量另用 progress.delta。

真实报告服务需要补齐：周期和时区、生成输入冻结、数据充分性判断、失败重试、版本替换/保留、删除或更正源事件后的处理规则。当前普通汇总的 `insufficient` 只表达本地有无可用记录，不能宣称为科学评测。

成果详情应区分“事件记录的形成过程”与“课程 expectedEvidence 的成果要求”。接入后若要声称孩子已提交/已达标，应由 SaaS 返回实际作品 ID、提交时间、来源、审核状态和可访问证据；不能用目录里的预期要求冒充已完成证明。

## 7. 位置、儿童信息、分享与删除

- 当前定位来自固定演示点，不是手机 GPS 或设备云数据；仅 5 分钟内作为有效点显示，离线/过期/未绑定清空坐标，不保存历史轨迹。真实时效、精度、定位来源及权限需另行确认。
- 当前联系人完整输入可能进入本地任务 payload/storage；不能把展示时打码当作存储加密。真实接入需最小化缓存、限定保留时间、隔离日志并控制敏感数据访问。
- 分享预览只允许 report/achievement，按 targetId 和 childId 验证归属。当前文字脱敏替换已知姓名、设备、家庭信息及部分手机号/时刻/坐标模式，是本地规则，不是完整的服务端隐私审查。
- 真实分享建议采用服务端字段白名单与独立分享凭证，明确有效期、撤销、访问范围、图片存储与清理；不要把孩子完整对象交给绘图页面再靠展示隐藏。
- 当前 PNG 是微信 canvas 导出的临时本地文件；相册保存只在 success 回调提示成功。拒绝授权保留预览。已经由用户保存到相册或对外转发的图片，不能承诺可由小程序远程撤回。
- 当前数据删除只处理当前孩子的本地探索事件、报告和关注；撤回同意/注销只让本机 session 及旧任务失效，不代表真实云端资料已删除或微信账号已注销。
- 真实删除、撤回、更正与注销要有明确责任主体、对象范围、处理记录、重试与最终回执；本文不代替隐私政策或法务审核。

## 8. AppID、环境配置与上线前条件

本机 `project.config.json` 已配置小程序 AppID 和基础库版本，这是本地工程运行配置，**不等于已核实 AppID 归属，也不等于该账号已获生产权限、相关类目、接口授权或合规批准**。

AppID 不能替代以下工作：

- 后端 code 换取真实身份、会话凭证、服务器合法域名及测试/生产环境隔离。
- 设备云接入资质、设备身份与指令签名、通话/定位/订阅等实际能力和权限确认。
- 微信侧隐私声明、用户授权、图片相册等系统权限和不同真机行为验证。
- 运营主体、监护关系、儿童信息处理规则与服务责任确认。

不要把 AppSecret、设备密钥、长期 token 写进小程序、演示文档或提交仓库。生产构建应移除/关闭隐藏场景入口和事件注入能力，而不是仅把按钮藏起来。

建议的交付顺序：

1. 三方确认 ID/目录/映射/计划版本与数据真源。
2. 完成后端登录和家庭 ACL，再开放任何真实孩子或设备读写。
3. 接入可信探索事件与报告快照，校验去重、年龄计划分母、证据和未知状态。
4. 接入设备云并逐项验证离线、超时、ACK、停止与重进恢复。
5. 接入隐私请求、通知、客服和分享存储；保留可查询回执。
6. 运行自动测试及开发者工具走查，再单列真机、真实设备和真实后台的验收证据；未验证项明确列出，不以模拟截图替代。

相关源文件：[API 门面](../miniprogram/services/api.js)、[模拟服务](../miniprogram/services/mock.js)、[目录与覆盖规则](../miniprogram/services/curriculum.js)、[本地状态](../miniprogram/services/store.js)、[异步保护](../miniprogram/utils/util.js)。操作走查见 [DEMO-SCENARIOS-V3.md](./DEMO-SCENARIOS-V3.md)。
