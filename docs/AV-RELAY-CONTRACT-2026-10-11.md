# 音视频接口对齐与回执演练说明

日期：2026-10-11。仅本地契约准备，未创建任何公网回调接口、未部署。

## 先由双方填写这些非秘密参数

| 参数/证据 | 当前/待确认 |
|---|---|
| 本项目 AppID | `wxc5abf3407ed4ef30`；OpenID 从本小程序本人获取，单独安全提供 |
| 实际主板/固件 | 鱼鹰 P4+C5；适配固件版本、实际 ESP-IDF、SDK 版本由硬件确认；不能直接套启明镜像 |
| SN / 微信 ModelID / 官方插件固定版本 | 尚待提供和平台许可核实；不得使用虚构设备 A 当真实 SN |
| 设备上线/服务发现/注册地址 | 供应商确认用途、协议、端口、认证与是否已注册测试设备 |
| 设备消息通知地址 | MQTT/WSS/其他长连接具体方案及所有者；主题/路径、ACK、取消及重连策略 |
| 媒体连接服务 | 供应商确认；会话 `peer_id` / token 必须来自可信服务，不能自行拼接或由小程序签发 |
| 用户/通话服务 HTTPS 地址 | 实际 user-server / voip-server 或等价实现；本 AppID 是否已配置；测试账号与设备绑定归属 |
| 原生微信回调 | 接收服务负责人、验签/解密配置方式；不能填我们目前未开放的 `/device/callback` |
| 双向音视频能力 | 音频编码/采样率/声道/帧长、AEC；摄像头/屏幕分辨率、帧率、方向；实际 profile 和实测证据 |
| 凭证签发与保存 | 设备密钥、用户 JWT、微信服务端密钥、媒体 token 各自签发方；只经安全渠道进私有服务端，不进本表 |

上述地址可以由同一服务承载，但责任和协议不能混淆。现有云托管业务调用地址不是通用 MQTT、WHIP 或转码地址。

## 三个必须先对齐的兼容问题

1. 当前 `providers/thingconnect.js` 按此前 ThingConnect 用户接口写了设备列表、登录、SN ticket、授权查询等。最新公开文档说明 `/v1/voip/*` 为业务服务**参考接口**，并不保证供应商已经托管、接口路径/字段/认证方式与旧版本完全一致。必须拿 SDK 2.3.0 实际对接服务的脱敏请求/响应验证，不能只填域名。
2. 当前小程序关联数据为 `callId/deviceId/bindingVersion/mediaType/expiresAt/hardExpiresAt`；公开参考文档还用 Payload 的 `id/from` 提取 `wx_call_id/wx_from`。请供应商确认本版本 `wx_payload` 编码、透传及映射规则，再写转换适配；不猜字段、不更改凭证。
3. 公开参考文档把 `cancel` 限定为小程序呼叫、设备尚未接听时取消。当前适配的 `endCall` 会发 cancel 但始终返回“未确认结束”。真机上线前必须补对齐**接听后的挂断/强制断开以及媒体停止确认**，不能用 HTTP 成功或本地超时冒充设备已停止。[供应商服务端说明](https://docs.tange.ai/products/wxvoip/en/guides/app-server.html)

## 我们内部标准化回执（待双方协议确认）

以下示例全为虚构；由可信服务将真实供应商/设备事件转成此格式。**不是原生微信 `iot_voip_notify`，也不是 TiRTC 原生事件。**

```json
{
  "kind": "call",
  "eventId": "SYNTHETIC-EVENT-1",
  "deviceId": "SYNTHETIC-DEVICE",
  "bindingVersion": 1,
  "callId": "SYNTHETIC-CALL",
  "roomId": "SYNTHETIC-ROOM",
  "version": 1,
  "state": "connected",
  "childAccepted": true,
  "mediaReady": true,
  "videoReady": true
}
```

`childAccepted` 表示明确的设备侧接听证据，本次由成人测试；`mediaReady` 不能仅映射“房间已创建”，视频还需 `videoReady`。需供应商说明如何取得设备接听、收发媒体及双向画面就绪证据，必要时补设备上报。无法证明时保持 connecting，不编造 true。

状态：calling → ringing → connecting → connected → ending → ended。版本只递增；房间、设备、绑定与呼叫关联必须匹配；拒接/忙线/无应答/离线等用 ended 及明确原因；结束后不能被迟到事件复活。实际双向声音/画面仍须成人手工验收，自动状态不是音画质量证明。

现有离线 HMAC 处理器要求 POST，头字段 `x-ailab-timestamp`（UTC 毫秒）、`x-ailab-nonce`、`x-ailab-signature`，签名为 HMAC-SHA256(`timestamp + "\n" + nonce + "\n" + rawBody`)；5 分钟时窗、签名校验及重复投递防护。工具使用一次性内存随机密钥且不打印它；生产协议、密钥生命周期和独立可信接入网络仍待设计。这不是可直接公开给设备调用的上线方案。

## 本机使用

在项目根目录执行：

```sh
npm run device:voip:check
npm run device:voip:rehearse
npm run device:voip:rehearse -- --example
npm run device:voip:test
```

不需要连接手机、硬件或云端；不启动监听端口。全部数据只在本次进程内存，退出即消失。本机演练不改变虚构测试设备 A 的云端权限。

设备侧对照 [供应商设备指南](https://docs.tange.ai/products/wxvoip/en/guides/device-integration.html)；小程序侧对照 [供应商小程序指南](https://docs.tange.ai/products/wxvoip/en/guides/miniprogram-integration.html)。文档可能更新，具体以双方确认的 SDK/服务版本和微信平台许可为准。
