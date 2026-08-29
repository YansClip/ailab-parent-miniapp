# AILab 微信小程序 V2 视觉回归证据

本目录保存 2026-08-30 在微信开发者工具中的实际渲染截图。当前自动截图视口为 344×743 像素的 iOS 模拟环境；截图用于验证页面结构、内容层级、状态和跳转结果，不代替发布前的 iOS/Android 真机验收。

## 全页面覆盖

- `all-pages/`：46 个注册页面逐页打开后的截图，文件名前两位与 `app.json` 页面顺序一致。
- `contact-sheets/all-46-pages.jpg`：46 页总览联系表；同目录另有 5 张分组联系表，便于放大检查页面间的一致性、重复模板、空白和明显排版问题。
- 已登录时直接打开欢迎页会按产品规则跳转首页；`welcome-final.png` 是清除会话后重新截取的欢迎页证据。

## 重点页面

| 证据 | 检查内容 |
|---|---|
| `welcome-final.png` | 欢迎主视觉、登录前信息层级和底部安全区 |
| `home-head-final.png`、`home-final-mid.png`、`home-final-lower.png` | 首页长页面、孩子切换、成果照片、兴趣足迹和待办 |
| `feed-final.png` | 全部动态的时间线、加载、空数据和失败恢复结构 |
| `guard-head-final.png`、`guard-stale.png` | 守护地图、五项工具、有效位置和位置过期 |
| `growth-head-final.png`、`growth-lower.png`、`growth-empty.png` | 成长洞察、启思简报、六维能力、报告、成果和空状态 |
| `dimension-final.png` | 能力维度分数、代表记录和家庭陪伴建议 |
| `my-final.png`、`my-lower.png` | 家长身份、家庭状态和功能分组 |
| `call-connected.png`、`call-final.png` | 语音呼叫、接通、静音、结束和失败恢复 |
| `contacts-nav-fixed.png`、`alarm-edit-final.png` | 顶部胶囊安全区、联系人和闹钟表单 |
| `bind-final.png`、`account-final.png`、`delete-final.png` | 绑定、账号和高风险操作 |
| `weekly-final.png` | 成长报告结构与脱敏分享入口 |

## 结论

- 46/46 页面均可编译和打开。
- 四个主页面和关键二级流程无明显遮挡、空白页或失效布局。
- 微信开发者工具控制台过滤 `error / warn / fail / exception` 后无输出。
- 真机字体缩放、系统键盘、授权弹窗和不同 Android 厂商微信版本仍列为发布前检查项。
