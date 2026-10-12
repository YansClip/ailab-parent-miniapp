# 定位后端：本机开发与下一轮联调

2026-10-10。用户确认：定位优先，本轮只做代码和本机测试；不购买服务器、不新增云资源、不部署、不上传。

## 已做到哪一步

新增链路：**认证 TCP 接收 → 签名 HTTP 上传 → 私有数据库当前点位 → 微信身份/设备授权查询 → 守护页数据适配**。测试用合成数据和本机服务，不代表实际硬件、微信身份或云端已接通。

原 `127.0.0.1:18866` 联调台、18765 接收程序及公网开关未改动。小程序仍为 `demo`、`cloudrun.enabled:false`，不替换已开通的 Django 模板。

| 部分 | 源码/配置 | 后续运行位置 |
|---|---|---|
| TCP 接收转发 | `server/mini-device-cloudrun/location-tcp-relay.js` | 本机合成测试；正式需支持 TCP/TLS 的独立服务器或甲方网关 |
| 上传服务 | `SERVICE_ROLE=location-ingress` | 独立 HTTPS 云托管服务，建议 `ailab-location-ingress`，HMAC 验签 |
| 家长查询服务 | `SERVICE_ROLE=business`、`LOCATION_PROVIDER=push` | 私有 `ailab-device-gateway`，只允许可信微信网关调用 |
| 数据库 | 现有 MySQL 8 适配/SQL 两张表 | 两服务共享私有测试库；新增集合名 `mini_location_channels`，不额外建表 |

上述服务名仅为规划，不是已创建。上传端没有家长查询接口，查询端没有公网上传接口。不能为了硬件上传把私有微信业务服务直接开放到公网。云托管公网文档提供的是 HTTP/HTTPS，不能把域名当成任意裸 TCP 地址。[官方访问说明](https://docs.cloudbase.net/run/develop/access/client)。

## 给硬件工程师的话

> 当前固定 17 字节格式继续用于原联调台。正式接入需要补充设备认证和 GPS 实际采集时间，否则只能证明收到坐标，不能确认位置时效。请确认固件能否支持 TLS 并校验服务器证书、发送认证首包，以及下面的 JSON 换行报文。暂不支持时先协商替代方案，不直接更换现有上传地址。

以下是**新接收程序支持的建议协议，尚待硬件确认**，不是已经约定的正式协议。

认证首包：`AUTH <deviceId> <独立设备token>` 后接真实 CRLF 字节。token 至少 32 字节安全随机数、base64url 编码，和服务器 HMAC 密钥分开。通过安全渠道交付，不放前端、Git 或群聊。IMEI/ICCID 注册不是认证；非本机接入必须 TLS 且硬件校验证书。

推荐定位 JSONL（每个对象后加真实 CRLF）：

```json
{"version":1,"status":"valid","measuredAt":1791612000000,"longitude":120.0001,"latitude":30.0001,"accuracyM":null,"battery":73}
```

坐标为合成示例；`measuredAt` 必须换为本次 GPS 采集时的 Unix 毫秒时间，不能照抄，也不能用服务器收包时间替代。坐标系由双方确认后固定在接收配置；精度和电量未知填 null，不能填 0 假装精确。

无定位时不发送旧坐标：

```json
{"version":1,"status":"no-fix","measuredAt":null,"accuracyM":null,"battery":73}
```

新协议当前未实现心跳或主动定位指令；持续上报停止后按时效判定离线。设备身份与绑定版本由可信配置固定，报文不允许指定家庭、孩子或家长账号。

### 旧格式兼容边界

`framing:'fixed17'` 支持初始注册 JSON＋`DDD.dddd_DD.ddddd`、拆包/粘包、可选真 CRLF、不回 ACK，但新接收器仍须先发送认证首包。

旧格式没有采集时间，新后台只确认接收，返回 `usable:false, reason:'capture-time-missing'`；不保存精确坐标、不显示正式有效地图。**原联调台的临时测试点显示不变。** 不要直接把新接收器地址给未实现认证的旧固件。

## TCP 网关→上传后台的内部契约

`POST /api/location/report`：

- `version:1`、唯一 `eventId`、`deviceId`、`bindingVersion`。
- `observedAt` 为可信 TCP 收包时间，`measuredAt` 为设备采集时间或 null。
- `status:'valid'|'no-fix'|'offline'`，`coordinateSystem:'WGS84'|'GCJ02'`。
- valid 时经纬度为十进制度数值，其他状态不带旧坐标；`accuracyM/battery` 可 null。
- 不传地址、家庭、孩子、OpenID、角色或密钥。

请求头为 `X-Location-Key`、`X-Location-Time`（Unix 毫秒）、`X-Location-Signature`。HMAC-SHA256 输入是 UTF-8 `POST\n/api/location/report\n<时间>\n` 拼接原始 JSON 字节，签名输出小写 HEX。HTTPS 校验证书、不跟随重定向；转发凭证有设备白名单。

响应 `{ok:true,data:{accepted,duplicate?,ignored?,usable?,reason?}}`：accepted 表示校验和数据库事务完成，usable 才表示当次检查可显示。重放不续在线时间，相同事件改内容拒绝，乱序/旧采集不能覆盖新点，旧绑定拒绝。只保存当前点及最小去重信息，无历史轨迹。离线/无定位立即清旧点，过期不返回坐标。

## 小程序这边

继续使用 `callContainer`、可信微信身份及真实设备授权；不导入本地演示家庭。WGS84 只转换一次，未知坐标系拒绝，电量/精度未知明确显示。

当前是被动上报，刷新显示“等待下一次上报”，不会声称已下发定位指令。只有新有效采集才完成等待；超时可重新等待。离页停止轮询，坐标按后台有效期清除，主体切换后旧响应拒绝。本轮 push 适配不开放音视频能力。

## 怎么验证和启动

```sh
npm run device:location:test
npm run verify
npm run device:cloudrun:package
```

测试自动开启/关闭本机临时端口，不连接实际硬件或云服务。部署包仅在本地生成；只含代码、依赖锁及空配置模板，不包含本机定位记录、密钥或小程序素材。

自行启动先安全填写 `.env.example` / `.env.relay.example`，模板不会自动生效。Node 22 可用 `--env-file=<权限受限的私有配置文件>`；不把真实密钥放进命令参数或截图。

- 上传端：`SERVICE_ROLE=location-ingress`、私有 MySQL、`LOCATION_RELAY_KEYS_JSON`，运行 `node server/mini-device-cloudrun/server.js`。
- 查询端：`SERVICE_ROLE=business`、`LOCATION_PROVIDER=push`，保持微信网关私有验证，HTTP 端口与上传端分开。
- TCP 端：`npm run device:location:relay`，默认新端口 18767，不占用原联调台18765。非本机必须 TLS。
- 两服务需显式填写全部时效。**仅测试参考**：位置60秒、状态30秒、订阅30秒、轮询5秒、刷新15秒、呼叫准备30秒、最大通话600秒；变量见 `.env.example`。正式指标需另行确认。

## 验证和剩余限制

新增16项测试覆盖鉴权、绑定、采集时间、坐标转换、去重/乱序、失败清点、过期、真实异步竞态、被动刷新、独立接口、TCP 拆/粘包及客户端适配。真实本机 MySQL 共5项集成测试通过，新增跨实例定位测试。仅合成数据，不是真机或云端证据。

最终回归：`npm run verify` 280项测试全部通过，46页/271个小程序文件，静态检查0错误/0项目警告；Git空白检查通过。独立部署包 `output/cloudrun-package-1791612093375`，Docker镜像 `ailab-location-backend:local-20261010` 构建通过。无外网容器冒烟：健康200、默认身份503 `AUTH_NOT_CONFIGURED`，符合默认拒绝保护。Docker工具提示旧构建器弃用，不是项目错误；未安装系统插件。临时 MySQL 容器测试后已关闭并自动删除，已有 Docker 服务未改动。没有推送或云部署。

尚未完成：服务器购买/部署、平台私有网关验证、真实 OpenID/家庭绑定、固件 TLS/认证/采集时间、地图现场准确性、iOS/Android 真机、正式规模/备份策略。

定位物理清理由进程定期清理；云托管缩容/停机时 interval 不运行，正式需可靠的私有定时清理。单次集合查询超过1000条会拒绝，正式扩大规模前需索引/分页。自动测试不能替代以上验收。
