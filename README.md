# AILab 微信小程序家长端

原生微信小程序（WXML / WXSS / JavaScript），以 Figma 当前可见 V3 页面为演示基准。
四个一级入口：**首页｜守护｜成长｜我的**。数据层当前为 Mock，接口形状可替换为真实 SaaS。

## 打开方式

1. 安装并打开[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 导入项目，目录选择本仓库根目录 `/Users/sc/WeChatProjects/miniprogram-1`。
3. AppID 沿用 `project.config.json` 中的 `wxa8a7abcefea84216`（或换成你的小程序 AppID）。
4. 基础库建议 2.20.1 及以上（本地 private 配置为 3.17.2）。
5. 编译后从欢迎页走完：隐私 → 微信登录 → 创建/绑定家庭 → 首页。

演示数据：家长 **陈然**、孩子 **林小满 / Mini 01**（可切换 **陈星河 / Mini 02**，用于离线态）。守护地图定位为广州番禺 · 广东科学中心。

## 目录

```
miniprogram/
  app.js / app.json / app.wxss
  custom-tab-bar/          72px 自定义 Tab
  assets/                  Figma 导出图标与插画
  components/              nav-bar、empty-state、child-switcher
  services/api.js          接口门面（接 SaaS 只改这里）
  services/mock.js         演示数据与设备任务状态机
  services/store.js        会话、当前孩子、演示场景
  pages/auth|family|home|guard|growth|my/
```

不依赖微信云开发。不提供历史轨迹、远程摄像头、学习一级页、商城。

## 质量检查

项目只依赖 Node.js 内置能力，不需要安装第三方 npm 包：

```bash
npm run verify
```

该命令会检查 46 个页面的注册与四件套、JavaScript 语法、WXML 事件方法、路由、资源、疑似敏感信息和重复样式，并运行状态隔离、异步安全与 Mock 数据单元测试。完整评测记录见 [`docs/QUALITY-AUDIT.md`](docs/QUALITY-AUDIT.md)。

孩子或设备切换时会先清空旧主体数据；轮询任务在离开页面后停止 UI 更新。联系人、闹钟、紧急联系人、家庭邀请等演示操作会写入本地存储，可通过退出登录或清除开发者工具缓存复位。

## Mock 场景

登录后：**我的 → 关于我们 → 演示场景**。

| 场景 | 效果 |
|---|---|
| 默认 | 林小满在线，完整首页/守护/成长 |
| 空数据 | 首页与成长按空态展示，不造数 |
| 加载变慢 | 请求延迟，便于看加载态 |
| 弱网/请求失败 | 接口拒绝，页面 Toast |
| 位置已过期 | 守护页清除坐标 |
| 设备任务失败 / 超时 | 通话、查找、同步等终态 |
| 报告生成中 | 周报/阶段报告生成中 |

也可在调试器执行：

```js
wx.setStorageSync('ailab.mock.scenario', 'empty')
wx.setStorageSync('ailab.session.v1', {
  privacyAccepted: true, loggedIn: true, familyReady: true,
  parentName: '陈然', role: '主管理员', phone: '138****2160'
})
```

绑定页演示异常码：`000000` 过期，`111111` 已使用。

## 后续替换真实接口

编辑 [`miniprogram/services/api.js`](miniprogram/services/api.js)，保持现有方法名与返回字段。页面不直接依赖 mock。设备任务需支持：已提交 → 执行中 → 成功/失败/超时 → 可再查询。

本版本**未连接**真实 SaaS、设备网关、定位与语音能力。页面中的“任务提交、设备执行、报告生成、分享和订阅”均为高保真模拟，不能直接提审上线。
