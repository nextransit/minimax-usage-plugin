# Changelog

All notable changes to this project will be documented in this file.

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
