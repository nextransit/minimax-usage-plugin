# Changelog

All notable changes to this project will be documented in this file.

## 0.0.18

- 修复启动时最小化场景下发现新版本但更新窗口不可见的问题。
- 更新弹窗渲染完成后再显示、取消最小化并聚焦主窗口，窗口操作结果写入运行日志。

## 0.0.17

- 当前周期剩余量小于本周累计剩余量时，展示本周累计剩余量，并使用独立紫色标注其来源。
- 修复桌面自动更新发布链路：生成并上传签名 updater 工件，`update.json` 使用正确的平台包与签名。
- App 启动后在前端监听器就绪时自动检查更新，发现新版本后显示更新窗口。
- 更新安装完成后使用 Tauri 原生重启流程重新启动 App。

## 0.0.16

- 桌面面板文案统一：周额度从「周剩余额度 / WEEKLY REMAINING」改为「周使用额度 / WEEKLY USAGE」，与当前周期「已使用」语义一致；进度条按已使用比例计算，状态阈值与当前周期对齐。
- 桌面面板周进度条视觉优化：底色变更为品牌色透明渐变 + 25% 刻度虚线，已使用部分增加流光与右侧呼吸效果；新增「当前时间点」指针（绿色=用量跑在时间之后、橙色=跑在时间之前），解决长周期场景下进度条长时间几乎不动带来的「系统未工作」观感。
- 密钥明细行的周条同步切换为「已使用 / 总额度」与「已使用百分比」展示。
- macOS 托盘栏标题与菜单比例统一：标题第二个值由「周剩余百分比」改为「周已使用百分比」；菜单项「剩余 / 本周剩余」改为「已使用 / 本周已使用」，数值与比例展示均按已使用计算。
- 工具提示（非 macOS）同步切换为「Weekly Used」。

## 0.0.15

- MiniMax 用量接口兼容新旧字段，按 `general` 模型优先解析当前周期和本周剩余百分比。
- 新增每个 API Key 独立配置当前周期额度和本周累计额度，用剩余百分比反推用量。
- 修复 VS Code 插件旧 API Key 配置字段迁移，避免旧配置刷新后用量显示为 0。
- 修复桌面端和 VS Code webview 数字显示偶发截断最后一位的问题。

## 0.0.14

- 支持 MiniMax Token Plan 新用量接口 `/v1/token_plan/remains`，并保留旧 `coding_plan/remains` 回退。
- 修复 `current_weekly_remaining_percent` 解析和周剩余额度展示。
- 修复 macOS 托盘栏周剩余额度百分比显示。
- 允许 Tauri IPC CSP 连接，修复桌面端 IPC 受限问题。

## 0.0.13

- VS Code Marketplace 扩展标识改为 `decard.minimax-monitor`
- Open-VSX 使用独立 namespace `benpay` 发布
- README 双语化，桌面版下载链接移至核心功能首位

## 0.0.12

- 修复 VS Code 插件无 API Key 状态栏入口，点击直接打开 API Key 管理对话框。
- 修复无 API Key 启动 500ms Toast 的“立即配置”入口，直接打开 API Key 管理对话框。
- 修复配额字段映射，`usage_count` 按已使用次数处理，剩余次数由总配额减已使用计算。
- 补齐 API Key 管理表头和操作按钮国际化。
- 补齐 VS Code webview 新增/编辑 API Key 时的国内/国际版 API endpoint 选择和保存链路。
- 统一风险弹窗规则：当前周期或本周资源剩余量比例低于 10% 时触发，弹窗保留并显示剩余/总量/比例。

## 0.0.11

- 修复风险告警误报：将当前窗口和每周配额分开判断，避免每周剩余低时误报为当前窗口耗尽
- 告警消息明确标注「每周」以区分时间窗口

## 0.0.10

- 完善多 API Key、悬停显示、桌面版功能

## 0.0.9

- 统一桌面端构建与发布 CI 流程
- 修复 countdown 闪烁、状态栏 per-key tooltip
- 修复 webview HTML 重建、状态栏百分比四舍五入

## 0.0.8

- add direct Marketplace publish script
- add GitLab CI automatic Marketplace publishing on `v*` tags
- add release validation for tag/version matching and `VSCE_PAT`
- update packaging rules for Marketplace-friendly extension bundles

## 0.0.7

- initial local `.vsix` based release
