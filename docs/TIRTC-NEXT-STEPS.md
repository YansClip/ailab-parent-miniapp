# TiRTC 音视频联调：小程序侧准备

> 2026-10-11 状态更新：业务云托管与数据库已由手机验证响应，以下“未部署/环境留空”为历史记录，不再代表当前业务连接进度。真实音视频仍未联调；请以 [最新双方联调方案](AV-JOINT-DEBUG-PLAN-2026-10-11.md) 和 [接口对齐说明](AV-RELAY-CONTRACT-2026-10-11.md) 为当前执行入口。

更新：2026-10-09。AppID：`wxc5abf3407ed4ef30`。

2026-10-10 补充：已确认开通的是微信云托管，新增独立 Node.js 后台与 `callContainer` 接入准备，详见 [云托管路线说明](CLOUDRUN-INTEGRATION.md)。以下 CloudBase 云函数步骤仍是可选旧路线，不需要把两种环境 ID 混填；目前没有部署任一路线的设备业务后台。

## 先看结论

本轮完成的是本地接入代码与自动测试，不是“真实音视频已接通”。默认仍是 demo，云环境留空、插件不开启；定位 TCP 接收程序和已有联调台没有改动。

新增入口：**我的 → 关于我们 → 长按顶部 AILab 品牌卡 → 体验设置 → 真实音视频接入准备**。无需先创建示例家庭；打开面板不会自动登录、收集 OpenID 或读取私有家庭数据。

| 项目 | 当前结果 |
|---|---|
| 真实 OpenID 获取 | 代码已完成；来自 CloudBase 可信微信上下文，仅返回本人，不依赖本地示例账号 |
| 登录 | cloud 模式只在后台身份核验后成功；不沿用示例家庭授权；游客仍可直接浏览 |
| 测试账号与设备 | 服务端账号关联、真实家庭授权与探鸽设备绑定取交集；不接受客户端角色或随意输入的设备号 |
| 微信通话授权 | SN ticket → 微信授权 → 新 code 关联 → report-auth → 后台授权查询；同步失败可单独重试 |
| 通话适配 | 官方插件 cloud-device 路线；支持已上报的视频方向、镜像和比例；不自行播放 MJPEG |
| 取消与挂断 | 使用探鸽 cancel 通知；提交成功不表示设备媒体已停止，保留“待确认” |
| 微信原生回调、MQTT、TiRTC 媒体 | 由探鸽已部署的 voip-server/设备侧承担；本机 CloudBase 代码不是转码或媒体服务器 |
| 权限、云部署、真实声音和画面 | 未验证。浏览器安全策略不允许本轮读取微信账号后台；没有部署、开通服务、生成凭证或上传 |

## 1. 现在只要先准备这些

甲方/微信管理员确认：本 AppID 的硬件 VoIP 权限、ModelID、官方 `wmpf-voip` 插件授权与选定版本；提供甲方持有的 CloudBase 测试环境及部署权限。不能只打开代码开关就认为权限开通。

探鸽/硬件方提供：

- 实际 `user-server` 和 `voip-server` 的 HTTPS 地址（可同域名），本 AppID 已配置在该服务的确认。
- 一名联调人员对应一个独立探鸽用户账号及有效 **user_jwt**，设备已绑定该账号。不要把设备密钥、mqtt_token 或媒体 token 当 user_jwt。
- 设备接入/服务发现地址、MQTT 地址、设备号与设备密钥；设备凭证由平台签发，不由小程序生成。
- 鱼鹰 P4+C5 的固件适配结果。启明镜像不可直接使用；麦克风、扬声器、回声消除、摄像头与屏幕需要分别确认。
- `profiles.voip` 实际上报内容，尤其 `up_video_mt`（设备→手机）、`down_video_mt`（手机→设备）、旋转和镜像。不从视频编码推断声音可用。

如只使用探鸽演示小程序先验证硬件，OpenID 属于其 AppID，不能拿来代替本项目 OpenID。

## 2. 先获取我们自己的真实 OpenID

以下部署操作本轮**没有执行**，需要账号持有人配合：

1. 在甲方 CloudBase **测试**环境部署 `cloudfunctions/miniDeviceGateway`。使用该目录 lockfile 安装依赖；正式部署前重新审查 SDK 依赖安全性。
2. 服务端设置 `MINI_APP_ID`；其余先保持未配置。`identity.get` 不依赖探鸽账号、家庭或定位参数。
3. 在 `miniprogram/config/device.js` 填入测试 `envId`。此时可以保持 `mode: 'demo'`、`voip.enabled: false`，只做身份准备。
4. 打开本小程序，主动确认隐私规则；在体验设置点击“获取本人真实 OpenID”。仅主动点击时请求，不在启动、游客浏览时自动收集。
5. 复制本人 OpenID，安全发给参与联调的工程师。OpenID 不等于通话权限，也不是密钥。获取失败时不会生成示例 OpenID。

## 3. 配置测试账号与绑定（可信后台操作）

按 `database.rules.json` 配置全部集合为前端不可读、不可写。新增 `mini_voip_accounts`、`mini_voip_authorizations`；它们不是可以直接公开导入的规则包。

授权关系使用原有 `mini_memberships`、`mini_bindings`。不要用本机示例家庭、姓名、绑定码代替。联调最小授权由甲方管理员在测试后台建立，正式家庭绑定系统后续接入，不新增客户端“自授管理员”接口。

`mini_voip_accounts`：文档 ID 使用服务端 `providers/thingconnect.js` 导出的 `accountKey(appid, openid)`；不接受前端指定账号。字段：

```js
{
  appid: 'wxc5abf3407ed4ef30',
  openid: '<本人真实 OpenID>',
  providerUserId: '<探鸽用户账号 ID>',
  userJwt: '<安全配置的有效用户 JWT>',
  expiresAt: /* JWT 实际到期时间，UTC 毫秒，不是随意加一年 */,
  active: true
}
```

密钥类数据只进服务端私有集合，不写进 Git、前端、日志、截图、文档或群聊。生产版本应迁移到专用密钥存储并实现账号生命周期。测试账号过期时明确阻断，当前不自动刷新 JWT。

**一个 AppID 下，同一探鸽账号不能分配给不同 OpenID。** 上游缓存微信身份的维度为探鸽用户＋AppID，共享账号会互相覆盖。后台会拒绝检测到的重复配置；正式关系服务需建立唯一索引/事务约束。

`mini_bindings` 的文档 ID、`deviceId` 和 `media.sn` 均使用实际探鸽设备号；内部孩子 ID、家庭 ID 来自正式后台。`media` 增加：

```js
media: {
  route: 'cloud-device', sn: '<实际设备号>', modelId: '<已核实的微信 ModelID>',
  approved: false,             // 平台许可核实后由管理员设置 true
  accountOpenid: '<此测试设备在探鸽的拥有者对应的 OpenID>',
  audioVerified: false,        // 确实具备双向声音后才设 true
  videoVerified: false         // 双向画面验证后才设 true
}
```

验证标记可以依据官方演示的硬件证据，但不代表已在 AILab 小程序验收。设备绑定发生变化必须提升 `bindingVersion`。

服务端 `.env.example` 新增配置：`VOIP_PROVIDER=thingconnect`、`THINGCONNECT_USER_URL`、`THINGCONNECT_VOIP_URL`、`PROVIDER_TIMEOUT_MS`。地址只填 HTTPS origin，例如 `https://公司确认的域名`，不要填 `api-tirtc` 媒体平台 API 或定位 TCP 地址。

## 4. 操作授权与测试

1. 体验设置 → 检查后台 → 读取真实测试设备 → 选择设备。
2. 点击“主动授权此设备通话”。名称以后台 SN ticket 返回值为准，不用页面缓存名称。
3. 若微信已操作授权、后台同步失败，点击“仅重试后台授权同步”；意图过期时重新检查/授权，不会自动拨号。
4. 查询微信与后台状态。微信状态为已关闭/无记录/未知时，不允许正式呼叫；未知不自动删除已有授权。
5. 在微信后台完成插件许可，再按官方文档给 `app.json` 添加实际获批版本的声明，provider 为 `wxf830863afde621eb`、别名 `wmpf-voip`。本轮没有添加未授权插件，也不使用未经确认的 latest。
6. 准备好下一节回执，并与硬件确认 `.env.example` 中的任务、定位、来电和通话时限参数后，切换 `mode: 'cloud'`、`voip.enabled: true`，进入真实语音/视频测试。缺配置或失败时不回退模拟数据。

## 5. 真正拨号前还有一项：接听与媒体回执

探鸽原生通话链路：`callDevice(isCloud=true)` → 微信原生回调 → 探鸽 voip-server → MQTT `call_incoming` → 设备 TiRTC。我们不会再发送第二份来电邀请。

**原生微信回调应配置到探鸽 voip-server，不是直接发到当前 HMAC 接口。** 供应方负责原生回调验签/解密、微信 AppSecret 和 TiRTC 应用凭证；不得放进小程序。

供应方/硬件需要确认：如何向我们的后台传递“接听、媒体就绪、拒接、结束”证据。既有自有中转协议见 `MINI-DEVICE-INTEGRATION.md` 第 5 节；这是双方需要确认的适配接口，不是 TiRTC SDK 原生自带功能。

`callDevice.payload` 会携带 `callId/deviceId/bindingVersion/mediaType/expiresAt/hardExpiresAt`；探鸽将其作为 `wx_payload` 透传。工程师在实际来电中解析、关联同一 roomId，并执行来电和最大通话时限。不能凭 payload 自身证明用户身份，身份由经验证的微信回调及绑定授权核验。

设备或可信服务报告字段：`eventId`、`kind:'call'`、`deviceId`、`bindingVersion`、`callId`、`roomId`、递增 `version`、`state`。接通还须 `childAccepted:true`、`mediaReady:true`；视频还须 `videoReady:true`。**房间创建、MQTT ACK、TiRTC 建连回调任一项，都不独自证明全部接通条件。**

本轮为未对齐回执设置了保护：只有 `MEDIA_STATE_RELAY_READY=true`，且双方约定的 HMAC 回调已配置，才允许创建真实通话。默认 false。取得实际报文、完成映射与测试后才开启，不是勾选即证明联通。

上游 `/user/cancel` 成功只表示取消通知提交，不标记媒体结束；等待真实结束回执。断线和超时需核对最终结果。设备主动呼叫小程序及其全局来电处理仍未实现，不属于本轮完成范围。

本适配器只接通话，不取代定位 TCP/设备云：不伪造电量，不制造位置，不把视频 profile 当定位能力。cloud 模式的守护地图可以显示“暂无有效定位”，不阻碍通过独立真实设备入口准备通话。

## 6. 自检与验收

```sh
npm run device:voip:check
npm run device:voip:test
npm run verify
```

第一项只读本地配置，不探测/开通真实平台；加 `-- --strict` 可让未准备项返回非零退出码。测试使用受控输入，不会连厂家服务器，不打印凭证。

双方联调依次保存脱敏证据：设备上线、实际来电、明确接听、双向声音、双向画面、双方挂断、拒接、无人接听、断网、连续第二次呼叫。视频方向/镜像在 iOS 和 Android 分别验证。

## 来源

- [探鸽官方演示与体验凭证申请](https://docs.tange.ai/products/wxvoip/get-started/use-tange-demo.html)
- [ThingConnect 小程序参考实现](https://github.com/tangeai/tirtc-server-example/blob/main/thing-connect/weixin-mini-program/README.md)
- [ThingConnect API 字段与业务码](https://github.com/tangeai/tirtc-server-example/blob/main/thing-connect/api-reference.md)
- [微信 callDevice](https://developers.weixin.qq.com/miniprogram/dev/framework/device/voip-plugin/api/callDevice.html)

这些资料会更新。正式接入前与厂家锁定服务端版本及报文，不直接假设其部署版本与仓库 main 完全相同。
