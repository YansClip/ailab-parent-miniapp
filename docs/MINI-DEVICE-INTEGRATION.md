# mini 设备接入说明

更新：2026-09-18。对应飞书《mini设备通信文档》修改版（修订 41）。

## 先看结论

小程序已经补充语音/视频页面、定位刷新过程、CloudBase 后台业务代码和微信硬件 VoIP 调用适配。**当前仍默认使用演示数据，没有连接真实设备，也没有部署云函数。**

厂家接口、样机和微信许可未提供，`providers/unconfigured.js` 故意返回“设备云尚未接入”，不是一个可直接用于生产的设备云实现。不要改成返回成功来绕过它。

- 本轮真实接入范围：当前位置、语音、视频。通讯录、闹钟、查找设备、家庭管理及成长等原模块继续保持原有演示实现。
- 接入模式只在守护模块生效；不能据此将整个小程序当成生产版上线。
- 不支持历史轨迹、录音录像、远程偷拍。设备主动来电、Android/WMPF 和其他媒体 SDK 不属于已实现路线。

## 1. 怎么看当前效果

1. 微信开发者工具打开项目，正常进入小程序。
2. 守护 → 语音通话 / 视频通话 → 呼叫。演示过程依次经过呼叫、等待接听、连接、接通；不会调用真实摄像头、麦克风。
3. 视频页面可模拟静音、扬声器、降噪和关闭本机画面；插画始终标记为模拟画面。
4. 我的 → 原有隐藏“体验设置”可选拒接、忙线、权限拒绝、离线、中断和超时。回到通话页重新呼叫验证。
5. 通话进行中不能通过孩子选择器换人。先挂断，再切换。
6. 守护 → 刷新位置；过期或离线不显示旧坐标。接入模式下刷新会查询同一定位任务，而不是重复下发。

## 2. 文件在哪里

| 部分 | 位置 | 作用 |
|---|---|---|
| 小程序公开配置 | `miniprogram/config/device.js` | 默认 `demo`，云环境和插件开关留空/关闭 |
| 页面数据入口 | `miniprogram/services/api.js` | 根据设备模式选择演示或接入，不自动兜底 |
| 云函数客户端 | `miniprogram/services/device/client.js` | 授权设备、定位订阅、任务查询、通话恢复与清理 |
| 微信媒体适配 | `miniprogram/services/device/voip.js` | `callDevice`、插件事件、官方通话页、按房间挂断 |
| 后台入口 | `cloudfunctions/miniDeviceGateway/index.js` | 小程序可信身份调用和独立鉴权的 HTTP 回调 |
| 后台业务 | `cloudfunctions/miniDeviceGateway/lib/service.js` | 权限、绑定版本、定位、去重、通话占用与回执 |
| 厂家适配位置 | `cloudfunctions/miniDeviceGateway/providers/unconfigured.js` | 收到厂家资料后替换，不应放前端 |
| 测试提供方 | `tests/fixtures/device-integration.js` | 只用于自动测试，不允许部署为正式设备云 |

## 3. 厂家给资料后，按这个顺序接

### A. 准备企业测试环境

- 公司持有的小程序 AppID 为 `wxc5abf3407ed4ef30`，本轮未修改。准备关联的 CloudBase 测试环境及权限。
- 正式家庭/孩子关系不能用本地演示姓名、角色、绑定码或设备 ID 代替。需要关系管理后台可靠地写入下面两类授权记录。
- 硬件方提供设备系统、测试云接口、SDK/型号、SN、样机和联系人。密码/密钥用安全渠道交付，不能放进本说明或前端。
- 确认时效参数后填写服务端 `.env.example` 对应环境变量。默认空值会阻止真实调用，示例测试数值不是正式验收指标。

### B. 建表与权限

`database.rules.json` 是**逐集合权限配置清单**，不是一个已自动发布的数据库规则包。集合均设为前端不可读、不可写，只由可信服务端访问。不要用“所有用户可读写”。

必要授权记录：

```js
// mini_memberships；由正式家庭后台维护，不提供客户端直接写接口。
{
  openid: '真实微信身份对应的 openid', familyId: '正式家庭 ID',
  childIds: ['有权限的孩子 ID'], active: true, consentActive: true,
  permissions: { viewDevice: true, locateDevice: true, callDevice: true }
}

// mini_bindings；文档 ID 必须等于 deviceId。
{
  deviceId: '正式设备 ID', familyId: '正式家庭 ID', childId: '正式孩子 ID',
  bindingVersion: 1, active: true, childName: '孩子显示名', deviceName: 'Mini',
  media: { route: 'linux-direct', sn: '厂家 SN', modelId: '微信型号 ID', approved: false }
}
```

`approved` 只有平台授权和样机验证完成后才能由管理员设置。`route` 本轮仅接受 `linux-direct` 或 `cloud-device`；不根据芯片名称猜测。

业务集合：`mini_current_locations`（每设备最多一个当前点）、`mini_location_watches`、`mini_operations`、`mini_calls`、`mini_call_locks`、`mini_event_receipts`。为关系查询建立 `openid + active`、`openid + familyId + active`、`familyId + active` 索引，并按实际云数据库提示完善索引。

隐私授权撤回、设备解绑或成员权限变化后，正式关系后台应调用服务器专用的 `reconcileAccess(openid)`，立即结束失去权限的通话和定位订阅。这个入口未暴露给小程序。单纯更改本地缓存不等于完成服务端撤权。

部署时还需配置私有定时任务调用 `maintenance()`，清理过期位置、停止过期订阅并终止到期通话。查询不返回过期位置，但数据库物理清理需要此任务实际运行。大规模运行前应按到期时间索引分页改造；当前单次集合扫描超过 1,000 条会明确报错，不静默漏处理。

云函数已锁定 `wx-server-sdk@4.0.2` 并生成 lockfile。2026-09-18 的 npm 审计仍报 6 个间接依赖/依赖链警报（5 高、1 中；0 严重），涉及 Axios、Lodash 及其上层依赖。**正式部署前需确认上游修复版本或经过兼容测试的修补方案，并复查审计**；不要直接运行 `npm audit fix --force`，当前建议包含不合适的旧版 SDK 降级。详见本轮实现报告。

### C. 实现厂家适配器

不要直接改页面。按现有函数签名替换提供方，在 `index.js` 引入实际实现：

| 方法 | 需要做的事 |
|---|---|
| `getDevice(scope)` | 返回 `deviceId`、绑定版本、在线、电量、状态采集时间、定位/语音/双向视频能力 |
| `getLocation(scope)` | 返回最新定位，必须包含 `deviceId`、`fixId`、绑定版本、经纬度、坐标系、实际采集时间、精度和状态；没有就返回 null |
| `startWatch(lease)` / `stopWatch(lease)` | 按订阅 ID 开始/停止；设备必须执行 `expiresAt` 自动到期，已停止订阅不得被迟到的续期重新开启 |
| `refreshLocation(command)` | 按唯一 `commandId` 下发定位，过期请求不离线排队，不把受理当定位成功 |
| `getOperation(operation)` | 查询原指令；返回规范化指令事件，或 null；不能生成新任务 |
| `inviteCall(call)` | 下发一次来电通知，含 `callId`、`roomId`、类型、绑定版本、超时及最大通话时限 |
| `getCall(call)` | 查询同一会话，返回规范化通话事件，或 null |
| `endCall(call)` | 真正停止媒体、退出房间；只有设备/媒体服务确认后返回 `{ confirmed: true }` |

所有网络请求由厂家适配器实施超时、鉴权、有限重试；重试必须复用原编号。不要记录完整请求/响应、精确位置、音视频内容或密钥。

`WGS84` 仅转换一次，`GCJ02` 不重复转换。未知坐标系拒绝显示。精度未知用 null，不能填 0 来假装精确。

### D. 接微信通话插件

1. 先确认企业 AppID 的硬件 VoIP 权限、型号和 license，再在平台申请插件。
2. 使用微信官方文档当时支持的插件版本，在 `app.json` 增加别名 `wmpf-voip` 的插件声明（官方 provider：`wxf830863afde621eb`）。本项目默认不声明未授权插件，避免影响演示编译。
3. 在 `miniprogram/config/device.js` 中填写测试 `envId`，切换 `mode: 'cloud'`；插件就绪才开启 `voip.enabled`。
4. 真实模式使用官方 `CALL_PAGE_PATH` 通话页；摄像头、静音、扬声器等以该版本实际能力为准。定制演示按钮不等于 SDK 支持。
5. Linux 直连：`callDevice` 建房后，`call.attach` 关联房间，后台邀请设备一次。
6. 云对云：`isCloud: true`，将 `callId` 放在 payload。微信经过验签/解密的回调触发设备邀请，`call.attach` 不再发送邀请。
7. 孩子明确接听后，硬件才加入媒体与采集音视频。设备回执必须确认接听及双向媒体可用。只有本机加入房间不能标记已接通。

官方参数表目前没有标明 `timeLimit` 的单位，因此代码不将服务端毫秒时限擅自换算传入 SDK。选定插件版本并核实后，可由可信后台在绑定记录的 `media.sdkTimeLimit` 填入该 SDK 要求的值。无论是否填写，厂家适配器与设备必须执行 `hardExpiresAt`，不能仅靠客户端计时挂断。

**当前没有微信原生回调解密适配。** 必须由选定方案的服务端完成验证、解密和字段映射，不能将原始微信回调直接当 JSON 接到现有入口。准备失败、SDK 不支持或权限未开通会明确报错，不会回退为假通话。

## 4. 小程序与自身后台的接口

通过 `wx.cloud.callFunction({ name: 'miniDeviceGateway', data: { action, payload } })` 调用。成功返回 `{ ok: true, data, serverTime }`；失败返回 `{ ok: false, error: { code, message } }`。

身份来自 `cloud.getWXContext()`，不接受前端自报 openid/角色。`scope` 为 `{ familyId, childId, deviceId, bindingVersion }`，每次服务端重新核验。

| action | payload 重点字段 | 结果 |
|---|---|---|
| `context.list` | 无 | 当前微信身份可访问的正式孩子/设备 |
| `device.status` | scope | 在线、电量、能力，不含位置 |
| `device.snapshot` | scope | 状态＋当前有效定位，需定位权限 |
| `location.watch` / `location.unwatch` | scope、requestId（订阅编号） | 订阅 ID、查询间隔、到期时间 |
| `location.refresh` | scope、requestId | 定位任务编号、状态与到期时间 |
| `operation.get` | scope、operationId | 同一任务最终结果 |
| `call.prepare` | scope、requestId、mediaType: voice/video | callId、状态及插件所需公开参数 |
| `call.attach` | scope、callId、roomId | 已关联房间的会话，不代表接通 |
| `call.current` / `call.get` | scope，get 另带 callId | 当前本人会话／指定本人会话 |
| `call.end` | callId | ended 或 ending（结束结果待确认） |
| `call.event` | scope、callId、roomId、eventName | 同步本机插件事件；不能证明孩子已接听 |

结果对象最小约定：

| 对象 | 关键字段与口径 |
|---|---|
| 设备上下文 | familyId / childId / deviceId / bindingVersion；绑定变化必须提升版本，不能沿用旧授权 |
| 位置快照 | fixId、status、displayable、point、coordinateSystem=GCJ02、accuracyM、measuredAt、expiresAt、address、serverTime；失效 point/address 必须为 null |
| 定位任务 | id、完整设备上下文、state、version、createdAt、expiresAt、errorCode；success 才表示收到本次新点位，timeout 允许查询最终结果 |
| 通话会话 | id/callId、完整设备上下文、mediaType、state、version、roomId、acceptedAt、connectedAt、endedAt、endReason、expiresAt、hardExpiresAt；前端不接收 openid、厂家密钥或内部配置 |

时间统一为 UTC 毫秒；精度单位米；未知值用 null，不用 0 代替未知。厂家字段只在提供方适配器中转换，页面不引用厂家私有字段。

## 5. 回执怎么映射

设备事件必须带 `eventId`、`deviceId`、`bindingVersion`。所有时间为 UTC 毫秒。

```js
// 新定位：kind=location，location 内同样带 deviceId 和 bindingVersion。
{ kind:'location', eventId:'唯一编号', deviceId:'设备 ID', bindingVersion:1,
  location:{ fixId:'新记录 ID', deviceId:'设备 ID', bindingVersion:1, latitude:30.25, longitude:120.15,
    coordinateSystem:'GCJ02', source:'GNSS', accuracyM:20,
    measuredAt:/* 实际采集时间 */, status:'valid', address:'粗粒度位置说明' } }

// 定位任务：accepted/executing/success/failed，递增 version。
// success 必须同时附带新 location，不能回传原点位或原采集时间。
{ kind:'operation', eventId:'唯一编号', deviceId:'设备 ID', bindingVersion:1,
  commandId:'原任务 ID', version:2, state:'success', location:/* 同上 */ }

// 通话：calling/ringing/connecting/connected/ending/ended。
{ kind:'call', eventId:'唯一编号', deviceId:'设备 ID', bindingVersion:1,
  callId:'原会话 ID', roomId:'同一房间', version:3, state:'connected',
  childAccepted:true, mediaReady:true, videoReady:true }
```

视频只有 `childAccepted && mediaReady && videoReady` 全部由可信设备/媒体服务确认后才接通。结束原因支持 rejected、busy、no-answer、offline、failed、interrupted、device-ended、parent-ended。已结束会话不能被迟到回执恢复。

云对云邀请由可信服务端映射成 `kind:'invitation'`，附 callId、roomId 和设备绑定字段；不需要由小程序再发第二份邀请。

### 可选的自有中转回调

`lib/callback.js` 仅提供 **AILab 自有中转 HMAC 示例协议**，默认关闭，不是厂家或微信既有协议。双方同意采用后才设置 `CALLBACK_PROTOCOL=ailab-hmac-v1`，并通过服务端环境设置至少 32 字符的独立密钥。

POST 原始 JSON，头部：`x-ailab-timestamp`（13位毫秒）、`x-ailab-nonce`（唯一编号）、`x-ailab-signature`。签名为 `HMAC-SHA256(secret, timestamp + "\n" + nonce + "\n" + rawBody)` 的小写十六进制值。允许 5 分钟时间偏差，重复编号不可换内容。不要开启网关请求正文日志。

## 6. 联调前最后检查

- [ ] 正式身份与家庭绑定来自服务端；演示角色不能获得设备权限。
- [ ] 厂家适配器已替换，状态、坐标、SDK 路线和时间参数已对齐。
- [ ] 回调验签/解密完成；微信原生回调和自有中转协议没有混淆。
- [ ] 数据库前端权限关闭、索引和定时清理已配置，撤权钩子已接入。
- [ ] 云 SDK 依赖安全警报已处理并完成真实 CloudBase 兼容回归。
- [ ] 定位订阅、来电邀请和通话有硬件端最大有效期，不依赖小程序一直在线。
- [ ] iOS / Android 真机及真实样机验证：位置移动更新、离线过期、语音双向、视频双向、拒接、忙线、挂断、后台中断、撤权。
- [ ] `npm run verify` 通过；云端部署与正式发布另行确认。

官方参考：[硬件 VoIP](https://developers.weixin.qq.com/miniprogram/dev/framework/device/device-voip.html)、[callDevice](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/callDevice.html)、[通话事件](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/onVoipEvent.html)、[CloudBase 调用](https://docs.cloudbase.net/cloud-function/how-use)。
