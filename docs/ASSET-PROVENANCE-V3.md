# V3 海岛素材来源与处理

## 本轮使用

用户指定 Figma 文件 `v8kEGepFSuohO8EiaGfmJM`（明亮海岛关卡版 v2），本轮读取设计上下文，作为同项目家长端视觉参考。

- 世界海岛：节点 `170:1439`；原图保存为 `_design-refs/island-v3/world.png`。
- 机器人/海岛画面：节点 `170:1160` 的设计资产；原图保存为 `_design-refs/island-v3/robot.png`。
- 运行导出：`miniprogram/assets/island/ocean-world.jpg`（850px，约 135KB）及 `robot-island.jpg`（440px，约 36KB）。

Figma 返回的原始资源链接：

- [海岛](https://www.figma.com/api/mcp/asset/2026a2e4-4614-48ce-afec-55b74803a119.png)
- [机器人](https://www.figma.com/api/mcp/asset/3e6ba7af-c8ef-4416-903e-d2f8c8e662b9.png)

链接可能过期，项目内保留来源副本。以上为用户指定设计中的既有素材，**不是本轮生成的原创插画，也不因读取而取得额外第三方再分发权**。正式发行前由项目权利人确认使用许可。

## 处理与保留

运行图进行了尺寸/格式压缩，以适应页头而非铺满业务内容；装饰海岛与守护 map 组件分开，不把插画当位置数据。该处理是对既有素材的机械转换，没有复制小方机角色或截图。

本轮未引用的旧图及图标移至 `_design-refs/retired-parent-assets/`，未不可恢复地删除。其他已有机器人、成果、头像及空状态图沿用项目资源；原始制作记录和权利结论以此前交付为准，本轮未重新认证其著作权来源。

Lucide 图标继续保留原许可。`miniprogram/` 目录约 1.7MB 是本地磁盘观测值，不等于微信正式打包审核后的体积；发布前仍需检查上传包体报告。
