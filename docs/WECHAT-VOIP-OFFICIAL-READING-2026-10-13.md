# 微信官方硬件音视频文档：阅读记录与实现约束

阅读日期：2026-10-13。资料来自用户提供的《微信硬件音视频文档归档.zip》，归档时间为同日。本文是项目理解与索引，不转载整包官方文档，也不是 SDK 已移植或实机已验收的声明。

## 1. 阅读与完整性范围

- 压缩包 SHA-256：`6d987443c1d6d0bcdb337ac2300bedc9f192d0a5986c3d352cf16cdd0b4796b8`。
- 已安全解压；完整阅读 **57 篇独立正文、162 张表、138 段代码**，查看 **56 个独立配图资源及 1 张用户补充截图**。正文内配图使用次数为 57。
- 对 57 篇整理版与 `sources/` 原始网页的正文、代码做独立对照：规范化空白后无差异；引用配图均存在。合并版 `index.html` 是相同内容的导航/汇总，不重复算文章数。
- 范围是归档内的 33 篇栏目页、23 篇补充引用页，以及另补的“手机微信呼叫设备（云代理）”。归档还列出 **57 个未纳入本包的进一步引用**；不能声称已经读完全部微信文档。
- 该文档归档内没有实际 RTOS/服务端 SDK 安装包、静态库或 `example` 工程。用户同日随后另提供 `cloudvoipsdk.zip`，已检查其版本说明、核心头文件/示例、ABI 与导出符号，见 [实际 SDK 核查](WECHAT-VOIP-PREFLIGHT-2026-10-13.md)；具体固件兼容、插件版本和许可仍待确认，不能凭网页片段臆造 ABI 或烧录固件。
- 在线复核未成功：官方页面浏览工具返回访问错误，文档检索服务额度不足。本记录以用户提供的官方网页快照为依据；插件版本、平台条件和收费实施前需再核对，不宣称已确认平台实时状态。

原始归档保留在用户本机资料目录，不放进公开代码仓库。下方编号与归档 `pages/001…057` 对应。

## 2. 本项目选哪一条官方路线

归档区分 Android WMPF、Linux 直连、RTOS 云对云；不是任选一个 API 名称就能互换。

按当前鱼鹰 ESP32-P4+C5 和嵌入式开发背景，拟选 **RTOS 设备 SDK + 微信云对云服务端 SDK + 手机官方 VoIP 插件**。最终以硬件实际运行系统、SDK 可移植性和样机验证确认。设备与开发者云之间的信令、音视频数据通道由开发者实现；微信官方 SDK 并不自动替我们实现这一段。依据：001、021、022、034。

微信云托管和 MySQL 继续承担业务身份、绑定、权限及必要状态。不能因为它们已经连通，就推断官方云对云媒体进程也已存在。

## 3. 平台、身份与票据

1. 按 036 核对微信认证的小程序主体、适用类目及硬件设备能力；按 001 核对音视频能力/型号申请与正式版审核条件。调试版本、体验者身份、样机审核不可相互替代。
2. `model_id` 来自平台硬件接入；设备 SN 由厂商定义并保证唯一。虚构测试设备 ID、IMEI、微信 SN 的映射须明确，不能默认三者相同。平台身份与我们业务家庭绑定是不同层。
3. 后台按 037 获取 `sn_ticket`：官方路径 `/wxa/getsnticket`；票据约 5 分钟有效，绑定相应型号/SN。手机或设备只拿本次必要票据，不能拿小程序 AppSecret。
4. 服务端 `access_token` 按 048 管理；需核对稳定版 token 或云托管官方调用能力后确定实现，不能提前假定只有一种取 token 方法。
5. 021 的 RTOS 注册/配置接口才是本项目起点；035/041/042 的 Android/Linux RPMB、旧认证 SDK 不能直接变成 P4 必需硬件条件。
6. 登录会话 `session_key`（052）与通话回调 `SessionKey`（022）不是一个凭证。两者均不写公开日志、仓库或普通聊天。

## 4. 两个呼叫方向必须分开

### 家长手机 → RTOS 设备

依据 006、026、034：

1. 业务后台先确认当前家长对指定绑定设备有呼叫权限，准备短期、可关联的呼叫意图。
2. 手机官方插件 `callDevice`，设置 `isCloud: true`；取得 `roomId` 后按文档进入官方通话页，已在该页不重复跳转。
3. 开发者云收到 `iot_voip_notify / join_voip_room`，验证来源、业务关联、权限、型号、SN 和时效；异常请求不能回“接受”。`payload` 只是关联材料，不能单独当认证。
4. 将来电通知转给设备，设备显示来电与接听/拒绝操作。
5. 设备主动接听后，服务器调用 **`wx_cloudvoip_session_cloud_call_join`**；未接听拒绝使用对应 listener 挂断；已有 session 使用 session 挂断。

**微信提醒授权与业务权限不是同一件事**：026/006/017 表明插件自 2.4.1 起，手机主动呼叫设备无需先获得 `requestDeviceVoIP` 的设备呼入提醒授权；但仍须验证我们的家庭绑定和 `callDevice` 业务权限。旧 `ensureCall()` 把两者串成统一前置，需要在新代码阶段拆分。

### RTOS 设备 → 家长手机

依据 021、022、026、051：

1. 家长先为该设备完成微信 `wx.requestDeviceVoIP` 提醒授权；还要满足业务绑定、允许呼叫的联系人关系。
2. 设备初始化/注册后，按 RTOS SDK 调用 **`wx_cloudvoip_client_call`**。
3. 微信向开发者云推送事件；云端验证并正确确认后，微信进行来电提醒；服务端使用 **`wx_cloudvoip_session_join`** 接入该方向的会话。
4. 手机按官方插件的进入参数、事件和生命周期接听；不能把 Android `initByCaller/callWMPF/pushToken` 接法套到 P4。

`wx.getDeviceVoIPList` 是手机回调式接口，可显示授权开关；失败或不可用应显示未知。归档没有提供可替代它的通用服务端“查询/撤销某用户微信设备通话授权”接口。客户端报告、业务授权表和旧供应商 `authList` 都不能被当作微信当前授权的权威证明；最终呼叫仍由微信能力判断。

## 5. 原生回调、云端 SDK 与进程

022 要求消息加密选“安全模式”。回调携带 `RoomId/SessionKey/ServerToken/Payload/ModelId/Sn`，示例还含 `FromUserName` 等标准事件字段。正确回复和幂等处理影响响铃，不能让 HTTP 重试创建多通通话。

- 普通 HTTPS 消息接收路径按 049 实现 URL 校验、安全模式消息验签/解密、AppID 校验和响应封装。`msg_signature` 与普通 URL 校验 `signature` 的计算对象不同，不能复用内部 HMAC 签名器。
- 022 展示的 `{errcode:0,errmsg:"ok"}` 是业务响应；049 的安全模式还定义回复消息的加密封装。实际 VoIP 回包必须用官方示例/调试工具验证，不能仅看一个 JSON 片段就定网络报文。
- 049 同时有微信云托管托管消息推送（环境、服务、路径），但它与 022 强制安全模式的交界没有在归档中讲透。须确认真实可信入口、到达容器的报文形态和 ACK 要求后选择；不默认必须把当前私有业务服务开放公网。
- CloudRun 业务身份网关、微信原生事件入口、设备数据入口各自有不同信任来源，不能混为一个接受任意 OpenID 的接口。

服务端 SDK 的明确约束：**x86_64、glibc ≥ 2.28、libcurl ≥ 7.84.0；一个进程同时只能处理一通 SDK 会话**。多通话需要多进程及自行管理 IPC/分配/资源清理；不能简单在现有 Node HTTP 进程里塞一个全局单例就宣称支持多用户。

`wx_init`、异步 operation 的结果与销毁、HAL 回调、会话销毁、`wx_stop` 必须遵照 SDK 生命周期（022/024/025）。设备 SDK 没有提供所有结束操作，设备挂断需要通过开发者通道通知云端 SDK 执行，不能只关闭前端页面。

官方 SDK 下载入口在 001/021/022 关联的 [cloudvoipsdk 仓库](https://git.weixin.qq.com/wxa_iot/cloudvoipsdk)。用户已手动下载并另行提供 ZIP；设备 v4 与服务端 D5100032 已完成接入前静态检查，不表示完成交叉编译、动态加载或真实通话。

## 6. 音频、视频与摄像头

### 双向声音

按 025 对齐官方 HAL 与设备/云端实际版本。典型音频接口使用 16 kHz、16 bit、单声道、20 ms PCM（每帧 640 字节）；这描述 SDK 接口，不等于设备到我们云端必须原样传裸 PCM。设备采集、播放、AEC/回声与实际网络编码/缓存需要一起验证。

### 双向画面

023/025 描述的是 H.264 等编码视频，不是旧路线的“手机 MJPEG、设备下行 JPEG”。以前摄像头能做 H.264 上行，不能证明设备能解码微信下行的视频。

- 上行注意宽高 8 对齐、SPS/PPS/I/P 顺序、无 B 帧、关键帧与请求关键帧处理、camera open 和通话状态；不能未接听就持续采集推送。
- 下行注意自适应分辨率、流方向和设备旋转/解码能力；不支持时需提出可行的设备侧优化或云端处理方案，估算成本后再决定。
- 自定义编码需要匹配微信客户端、插件和 SDK；归档指出微信 ≥ 8.0.54、插件 ≥ 2.4.5 及相应 SDK 支持。`encodeFixedLength/encodeVideoRotation/encodeVideoRatio/encodeVideoMaxFps` 与服务器订阅参数必须配套，不能只改一端。
- UI 的 `aspectRatio` 与编码的 `encodeVideoRatio` 不同：012 配图中的显示比例为高/宽；023 编码参数按宽/高 × 100。`contain` 配图建议屏幕高/宽以减少裁剪，不能一律改成流宽/高；旋转、镜像、裁剪用真机确认。
- 初次视频按可验证的小分辨率/帧率起步，不许先承诺 1080p/4K、固定超低延迟或移动网络流量费用。

### 独立摄像头组件

018 的 `camera-device` 是独立画面查看能力，插件更新日志 017 记载 2.4.6 新增；它不是双向通话必须加装的第二个组件。`qualitylist/changeQuality` 只定义 UI 与通知，设备/云端仍须真实切换质量；界面写“4K”不会让摄像头自动具备该能力。

已阅读此文；用户于 2026-10-13 明确确认只做双向音视频通话，摄像头用于通话，不增加“非通话直接查看画面”。因此本轮不接入该独立组件。已确认需求是不保存录音录像；不增加静默监控、录制、截图上传或历史回看。

## 7. 插件、来电提醒与异常

- 002/038：声明并申请官方插件，provider `wxf830863afde621eb`；初始化方式 `requirePlugin(alias).default`，版本实施时固定到已验证版本，不能将归档的 2.4.6 当作平台永远最新版本。
- 004/010：使用官方通话页；事件监听放在合适的单一生命周期并清理，不在每次 onShow 重复添加；记录进入、响铃、接听、结束等不同证据。
- 008/009：已有页面再次进入时，`getPluginEnterOptions` 不保证最新 query；按 `callPageOnShow` 后的 `getPluginOnloadOptions` 处理，避免旧房间、冷/热启动错配。
- 007：按明确 roomId 挂断，避免旧任务结束新通话。异常/迟到/重复回调不能复活已经结束的会话。
- 015/032：权限、许可、身份不匹配、忙线、网络、媒体启动失败等分开显示，不把所有错误变成“再试一次”，不自动反复弹授权或重拨。
- 033：iOS/Android 通知、锁屏、勿扰、后台限制影响提醒；桌面微信能力不替代手机。需要覆盖前台、后台、锁屏、冷启动和通知被关闭，不能保证所有系统状态 100% 响铃。
- 050 的设备订阅消息不是 VoIP 响铃机制；校园刷脸/支付（016）、Android 预热（030）不列入本项目 RTOS 最小实现。

## 8. 文档差异与仍须核实的事项

| 位置 | 观察到的差异/缺口 | 处理规则 |
|---|---|---|
| 021 与 034、实际 v4 | 旧 RTOS 文本和 v4 README 包含 `client_join`；v4 库导出该符号但所附头文件缺声明。专门云代理页采用设备接听后 `session_cloud_call_join` | 手机呼叫先按 034；D5100032 已核实有 cloud_call_join，不叠加未经核实的设备调用，不猜声明 |
| 022 正文与复用头文件注释 | 正文说服务端初始化不需 appid/modelid，附带初始化结构注释又有通用设备字段说明；D5100032 例程初始化用配置/目录/HAL，join 再传身份 | 已按所选例程/头文件核对初始化；仍需兼容运行验证，禁止把共用注释推断成必填 |
| 022 与 049 | VoIP 展示业务 ACK，通用安全模式描述加密响应；托管消息推送又有另一入口 | 用官方测试消息/示例确认外层格式与可信边界，再上线回调 |
| 023 前部与后部 | 一处写上限 640×480，另一处上行写到 1080p | 标记版本/场景差异；首测小分辨率，不承诺最大规格 |
| 006 与 023 | API 表参数与视频指南 query 配置的写法不同 | 按所选插件/SDK 示例和实测收流确认，勿同时乱填多套参数 |
| 022 与 023 | 服务端 FPS 注释 5～15，插件自定义编码 8～15 | 首测选择共同支持范围并实测，不假设任一端设置独立生效 |
| 012 与 017 | 自定义半屏高度有 70vh / 75vh 的记录差异 | 非最小通话所需，首期不使用，后续查实际插件版本 |
| 026 与 040 | 授权列表字段描述有 groupId/group_id 差异 | 以实际 API 表及真机响应校验；首期单 SN，不引入设备组复杂度 |
| 047 归档来源说明 | 参考扩展原标记为 wx.authorize，实际保存正文是 wx.authorizeForMiniProgram | 已按实际 API 阅读；不能用它替代 `requestDeviceVoIP` |
| SDK 与进一步引用 | 实际包/示例另行取得；许可与进一步引用、稳定版 token 等仍未全部覆盖 | 按实际 SDK 核查记录推进；缺失或矛盾先记录证据，不推演成已知接口 |

## 9. 全部 57 篇阅读索引

以下均已完整阅读正文、表格和代码；非本路线章节也已阅读，并明确不直接套用。配图按资源检查。用途分类不是声称该功能已经实现。

| 编号 | 官方文档 | 本项目用途/阅读结论 |
|---|---|---|
| 001 | [小程序音视频通话+摄像头（for 硬件）](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-voip.html) | 架构、许可、平台、SDK 入口 |
| 002 | [VoIP 通话插件](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/) | 插件声明、入口与用法 |
| 003 | [initByCaller(Object req)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/initByCaller.html) | Android/刷脸相关，不作为 RTOS 手机呼出入口 |
| 004 | [发起通话接口介绍](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/call-intro.html) | 官方通话页与接口选择 |
| 005 | [callWMPF(Object req)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/callWMPF.html) | Android WMPF，不用于 P4 |
| 006 | [callDevice(Object req)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/callDevice.html) | RTOS 云代理呼出 isCloud |
| 007 | [void forceHangUpVoip([string roomId])](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/forceHangUpVoip.html) | 指定房间挂断 |
| 008 | [Object getPluginEnterOptions()](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/getPluginEnterOptions.html) | 进入参数及复用边界 |
| 009 | [Object getPluginOnloadOptions()](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/getPluginOnloadOptions.html) | 热启动/当前通话参数 |
| 010 | [function onVoipEvent(function listener)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/onVoipEvent.html) | 事件订阅、解绑及状态 |
| 011 | [void setCustomBtnText(String btnText)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/setCustomBtnText.html) | 可选自定义按钮 |
| 012 | [void setUIConfig(Object config)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/setUIConfig.html) | 显示比例、旋转、镜像、裁剪 |
| 013 | [void setVoipEndPagePath(Object req)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/setVoipEndPagePath.html) | 结束后的页面与导航 |
| 014 | [getIotBindContactList(Object req)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/getIotBindContactList.html) | 插件联系人查询，不是后台通用授权 API |
| 015 | [VoIP 插件错误码](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/errCode.html) | 错误分类 |
| 016 | [校园场景支付刷脸模式](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/wxpay.html) | 校园支付刷脸，不在首期 |
| 017 | [小程序音视频通话插件更新日志](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/changelog.html) | 版本差异、摄像头 2.4.6 |
| 018 | [小程序摄像头插件](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/index_camera.html) | 已读；用户确认不做独立查看，摄像头只用于通话 |
| 019 | [开发安卓设备端应用](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/device-app-android.html) | Android 路线区分 |
| 020 | [小程序音视频通话 SDK (Linux 设备)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/voip-sdk.html) | Linux 直连路线区分 |
| 021 | [RTOS 设备](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/le-device-sdk.html) | 本项目 RTOS 设备 SDK |
| 022 | [云对云服务端](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/cloud-server-sdk.html) | 官方云对云服务端 SDK/回调/进程 |
| 023 | [VoIP 视频流指南](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/voip-video.html) | 编解码、分辨率、方向、帧率 |
| 024 | [异步接口使用指南](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-sdk/wx_operation.html) | 异步 operation 生命周期 |
| 025 | [硬件抽象层](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-sdk/hal.html) | HAL 采集、播放、存储和网络接口 |
| 026 | [用户授权设备](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/auth.html) | 区分两个呼叫方向的授权 |
| 027 | [设备呼叫手机微信](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/call-wechat.html) | 设备呼入流程对照；区分 Android 与 RTOS |
| 028 | [手机微信呼叫设备(安卓)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/call-wmpf.html) | Android 手机呼出，非本路线 |
| 029 | [手机微信呼叫设备(Linux 直连)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/call-device.html) | Linux 直连手机呼出，非本路线 |
| 030 | [性能与体验优化](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/performance.html) | 性能条件；Android 预热不直接套 RTOS |
| 031 | [常见问题（FAQ）](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/voip-faq.html) | 能力、费用/流量、限制与排错参考 |
| 032 | [通话异常排查指南](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/guide.html) | 分阶段故障排查 |
| 033 | [通话提醒异常排查指南](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/notification.html) | 手机通知/锁屏/后台排查 |
| 034 | [手机微信呼叫设备(云代理)](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip/call-cloud_device.html) | 本项目手机→设备的专门流程 |
| 035 | [设备认证](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-register) | 设备身份与不可随意修改的 SN |
| 036 | [硬件设备接入指引](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-access) | 主体、类目、硬件能力登记 |
| 037 | [获取设备票据](https://developers.weixin.qq.com/miniprogram/dev/server/API/hardware-device/api_getsnticket) | 官方短期 SN ticket |
| 038 | [使用插件](https://developers.weixin.qq.com/miniprogram/dev/framework/plugin/using) | 插件申请、声明、作用域 |
| 039 | [Object wx.getAccountInfoSync()](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/account-info/wx.getAccountInfoSync.html) | 当前小程序身份/版本环境 |
| 040 | [wx.getDeviceVoIPList(Object object)](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/device-voip/wx.getDeviceVoIPList.html) | 真机授权列表回调 API |
| 041 | [设备认证 SDK（安卓）](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-register-sdk) | 旧 Android 认证方案，不套用 |
| 042 | [使用 WMPF 认证设备（安卓）](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-register-wmpf) | Android WMPF 认证，不套用 |
| 043 | [设备组](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-group) | 设备组，首期不启用 |
| 044 | [Object wx.getEnterOptionsSync()](https://developers.weixin.qq.com/miniprogram/dev/api/base/app/life-cycle/wx.getEnterOptionsSync.html) | 小程序入口生命周期 |
| 045 | [Page(Object object)](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page) | 页面生命周期、异步和清理 |
| 046 | [组件框架](https://developers.weixin.qq.com/miniprogram/dev/framework/component-framework/index) | 组件框架背景 |
| 047 | [wx.authorizeForMiniProgram(Object object)](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/authorize/wx.authorizeForMiniProgram.html) | 实际为 authorizeForMiniProgram，非设备 VoIP 授权 |
| 048 | [获取接口调用凭据](https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-access-token/api_getaccesstoken) | 后端 access_token |
| 049 | [消息推送](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push) | 验签、加密、托管推送及调试工具 |
| 050 | [小程序设备消息](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-message) | 设备订阅消息，非来电响铃 |
| 051 | [wx.requestDeviceVoIP(Object object)](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/device-voip/wx.requestDeviceVoIP.html) | 主动设备通话提醒授权 |
| 052 | [小程序登录](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login) | 登录身份与 session_key 边界 |
| 053 | [wx.exitMiniProgram(Object object)](https://developers.weixin.qq.com/miniprogram/dev/api/navigate/wx.exitMiniProgram.html) | 用户触发退出的限制 |
| 054 | [启动性能](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/start) | 启动性能参考，不是已达标保证 |
| 055 | [设备组删除设备](https://developers.weixin.qq.com/miniprogram/dev/server/API/hardware-device/api_removeiotgroupdevice) | 设备组删除接口，非首期 |
| 056 | [设备组添加设备](https://developers.weixin.qq.com/miniprogram/dev/server/API/hardware-device/api_addiotgroupdevice) | 设备组添加接口，非首期 |
| 057 | [查询设备组信息](https://developers.weixin.qq.com/miniprogram/dev/server/API/hardware-device/api_getiotgroupinfo) | 设备组查询接口，非首期 |
