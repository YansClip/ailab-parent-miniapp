# 微信云托管接入：下一步怎么用

更新：2026-10-10。本次只完成本地代码与测试，未部署、上传或更改云控制台。

后续补充：已新增本机定位后端的 TCP 转发器、独立签名上传服务和 push 适配，见 [定位后端开发与联调](LOCATION-BACKEND-2026-10-10.md)。以下“尚未接定位上传”为之前基线；新代码仍未部署、未启用，不改变 Django 模板或默认演示模式。

## 先分清目前有什么

你已经开通环境 `prod-d4gzywf6m065e947c`，截图中的 `django-dmgd` 是正常运行的官方模板。`/api/count` 是计数接口，不能当定位、通话或 TCP 接收接口。本轮未请求该接口、未增加计数、未替换 Django。

我们另备了一份 **Node.js 设备业务后台**，建议新服务名 `ailab-device-gateway`，复用现有 JavaScript 设备权限和业务代码。这个服务名目前只是部署计划，不能当作已经创建。

小程序：`callContainer` → 独立设备后台 → 私有家庭/设备授权 → 后续设备/媒体服务。

这份后台管身份、权限和通话流程，**不收裸 TCP、不转码、不转发音视频**。现有本机定位接收程序、联调台保持不变；把定位搬上云、接 TiRTC 媒体服务器需后续单独对接。

## 1. 本地代码可先检查（不碰云端）

项目目录运行：

```sh
npm run device:cloudrun:check
npm run device:cloudrun:test
npm run verify
npm run device:cloudrun:start
```

默认只监听本机 `127.0.0.1:8080`。打开 `http://127.0.0.1:8080/healthz` 可以看到程序存活；这**不证明真实微信身份、数据库或硬件已接通**。默认所有私有业务拒绝访问，不支持给本机请求随便填 OpenID 来冒充家长。

## 2. 部署时需要你另行确认（本轮没有做）

1. 在现有环境**新增**设备业务服务，不覆盖 `django-dmgd`。新增服务/实例/数据库可能计费，先核实套餐和预算；当前环境叫 `prod`，不要当作可随意清空的测试环境。
2. 使用 `npm run device:cloudrun:package` 生成独立白名单目录。只包含这份后台、依赖锁及共用业务库，不含小程序素材、本机联调日志、真实定位或任何 `.env`。不要上传整个项目。
3. 用生成目录作 Docker 构建上下文。打包脚本现在会在部署包根目录额外放置一份相同的 `Dockerfile`，适配网页上传：目标目录留空（根目录），Dockerfile 选择“有”，名称填 `Dockerfile`。不要将目标目录改成 `server/mini-device-cloudrun`，否则会缺失共享业务代码。此前没有根目录 Dockerfile 的旧包需要重新生成、重新选择上传。容器端口为 **8080**，不是 Django 的 80；云健康检查路径为 `/healthz`。镜像内默认 `HOST=0.0.0.0`，本机启动默认仍是环回地址。不要在容器变量里误设 `HOST=127.0.0.1`。
4. 以服务端 `.env.example` 为填写参考，不把模板文件本身当作已经生效的环境变量。
5. **在新设备业务服务关闭公网域名、所有自定义域名及其他未鉴权入口**，核实只允许本 AppID 经微信 `callContainer` 网关访问。确认后才设 `WX_GATEWAY_ONLY_CONFIRMED=true`，并配置 `WX_CLOUDRUN_ENV`。仅小程序调用不需要开放公网网页。
6. 小程序获授权访问该环境、基础库满足官方 `callContainer` 要求（文档目前为最低 2.23.0）；使用微信真机验证，不把开发者工具关闭域名检查当通过。

**安全重点：`X-WX-OPENID/X-WX-APPID/X-WX-SOURCE` 只是 headers，不是我们自验的签名。只有网关真实核验、私有入口隔离成立才可信。`WX_GATEWAY_ONLY_CONFIRMED` 只是人工确认开关，不会替你关闭公网；未核实之前保持 false。不能开放公网后靠“请求带了 X-WX-SOURCE”当作鉴权。** 若后续需公网厂家回调，要拆分独立验签入口并重新审查，不在此服务上直接开公网。

## 3. 先接通身份，再准备私有数据

第一次可保持 `STORAGE_DRIVER=disabled`：

- `identity.get` 可在网关核验后返回本人真实 OpenID。
- `system.health` 返回数据库未准备好、音视频未验证。
- 任何家庭/设备数据读写返回 `STORAGE_NOT_CONFIGURED`，不自动创建演示家庭。

需要真实设备列表时，提供甲方认可的**独立私有 MySQL 8 数据库**，设 `STORAGE_DRIVER=mysql` 与连接参数。该适配代码已备好，未开通任何数据库；若已有数据库先评估复用，不能直接导入正式家庭数据。

1. 管理员在批准的测试数据库手动执行 `server/mini-device-cloudrun/schema.sql`，仅建两张独立表；不建库、不导入家庭、不清空旧表。运行账号仅授予两张表所需 CRUD，不授予建库/DDL 或其他业务表权限。
2. 默认 TLS 且校验证书。若平台私有内网数据库不支持 TLS，必须核实网络隔离后才能设 `MYSQL_TLS=false` 与 `MYSQL_PRIVATE_NETWORK_CONFIRMED=true`；不得向公网开放 MySQL 或关闭证书校验凑成功。
3. `mini_gateway_records` 中 `collection_name` 对应原集合名、`record_id` 对应原文档 ID、`data` 保存对象；`mini_gateway_mutex` 用于跨实例事务锁。原 CloudBase 文档**不会自动迁移**。
4. 由可信管理员维护真实 `mini_memberships` 与 `mini_bindings`，对象字段沿用 [设备接口说明](MINI-DEVICE-INTEGRATION.md)。用户端没有“自授管理员／随意绑定 SN”接口。OpenID、真实孩子信息、设备凭证不写进交付包、日志或 Git。
5. 数据库中同一设备 ID 只保存最新定位。初始化表不等于家庭授权、设备云或位置已接通。暂未接云端位置上传，`deviceProvider` 缺配置仍明确失败。

事务为初期小规模联调使用单行锁；正式并发规模、索引、备份、保留策略和私有维护调度需进一步验证。当前请求不公开 `maintenance/reconcileAccess/deviceEvent` 管理动作。

## 4. 小程序里怎么验

本地 `miniprogram/config/device.js` 已记录环境、规划服务名和 `/api/gateway`；仍 `mode:'demo'`、`cloudrun.enabled:false`、`voip.enabled:false`。**现在不用改成 cloud，也不要把“未部署启用”提示当代码坏了。**

新服务部署并核实私有访问后：

1. 将实际服务名填写到 `cloudrun.serviceName`（若不同于建议名称），设置 `cloudrun.enabled:true`。环境 ID 只填 `cloudrun.envId`，不要抄进旧云函数 `envId`。初次身份测试可以保持 demo。
2. 我的 → 关于我们 → 长按顶部 AILab 品牌卡 → 体验设置。打开面板不自动收集身份。
3. 主动登录/同意隐私后，点击 **检查云托管业务连接**。业务已响应与数据库已准备好分别展示；不是声音、画面成功。
4. 点击 **获取本人真实 OpenID**。仅保存在内存；失败不生成假 OpenID。确需给硬件工程师时再手动复制，不发密钥。
5. 数据库与真实绑定确认后验证本人可见设备、其他家庭不可访问、撤权后立即拒绝。只有真实设备范围准备好，再单独切换 cloud 模式；首页/成长等未接 SaaS 的模块仍保留原演示边界。

后台 `/api/gateway` 请求：`{ action:'identity.get', payload:{} }`。响应：`{ ok:true, data:{ appid, openid, source:'wx-cloudrun-gateway', isDemo:false }, serverTime, requestId }`。失败为 `ok:false,error:{code,message}`，失败 HTTP 不作成功。客户端不提交 OpenID、管理员角色或密钥；设备 scope 由后台二次核验。

## 5. 后面定位和音视频还缺什么

- 定位：本机 TCP 与云后台的安全转发/设备身份映射、采集时间/精度、WGS84 声明与 GCJ-02 输出、在线状态、时效、订阅/刷新回执。当前未把本机地址直接暴露成正式定位接口。
- 音视频：微信硬件权限、ModelID/SN、已授权插件版本、设备固件/SDK、实际 user-server/voip-server 与媒体回执。新业务后台不等于 TiRTC 服务器。
- 本阶段后台强制不启用真实媒体及公网回调；没有通过填 `MEDIA_STATE_RELAY_READY=true` 绕过这些条件的入口。
- 将来启用正式设备业务前，需要身份、数据库、绑定、撤权清理及跨实例测试证据。原云函数配置仍可选择 `transport:'function'`，但需自己的 CloudBase 云函数环境，不能共用云托管环境名充数。

## 官方资料

- [微信云托管调用方式](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/call)
- [微信网关附带的身份 headers](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/weixin)
- [CloudBase 小程序访问云托管](https://docs.cloudbase.net/run/develop/access/mini)
- [公网访问及网络关闭说明](https://docs.cloudbase.net/run/develop/access/client)
- [MySQL2 参数化执行](https://sidorares.github.io/node-mysql2/docs/examples/queries/prepared-statements)

控制台规则可能更新；部署者执行前按当前官方说明核对，不凭模板示例承诺硬件已可通话。
