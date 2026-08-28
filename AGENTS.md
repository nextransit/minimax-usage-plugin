# MiniMax Monitor 开发规则

## 分析方法论

### 核心原则
1. **所有分析必须基于源码和日志**
2. **禁止猜测，使用"可能是"等模糊词汇**
3. **每一步分析都要有源码或日志证据**

### 分析流程
1. 找到相关源码（grep/find）
2. 确认函数调用链
3. 添加日志验证
4. 基于证据得出结论

### 日志输出规范
```
[模块名] 操作: 具体值
  ↓
[模块名] 结果/状态
```

### 问题报告格式
```
**问题**: 具体描述
**证据**: 
- 源码位置
- 日志输出
**根因**: 基于证据的分析
```

## 构建与测试

项目含两部分：VS Code 插件（`src/`，TypeScript）与独立桌面应用（`src-tauri/` Rust + `src-web/` 原生 JS）。

### 命令
- 桌面 App Release 构建（需 macOS + 可访问 crates.io）：`npm run tauri:build`
- 桌面 App CI/无签名构建：`npm run tauri:build:ci`
- VS Code 插件编译：`npm run compile`；打包：`npm run package`
- 安装脚本：`install-app.sh`（内部即 `npm run tauri:build`，本环境无法跑：Linux 容器无网络拉取 Rust 依赖、无 macOS SDK）
- **前端测试**：`node --test tests/*.test.cjs`（基于 `node:test`，通过 vm 从 `app.js` 抽取函数；`tests/aggregate-progress-ui.test.cjs` 覆盖 `getAggregateMetrics` / `renderAggregateView`）
- **Rust 测试**：`cd src-tauri && cargo test`（`tray.rs` 含汇总聚合测试 `tray_summary_*`）

### 关键陷阱（易踩坑）
1. **当前周期 vs 本周累计是两套独立计数**，不要交叉。汇总（web `getAggregateMetrics` 与 Rust `SummaryUsageData::from_usage_map`）只累加，不要像旧代码那样用 `selectRemainingDisplay` 把"周剩余"混入"当前卡片"显示（这是已修 bug，见提交 `fa695a1`）。
2. **配置反推污染汇总**：当 MiniMax API 未返回当前计数但带 `remaining_percent` 时，`api.rs::apply_configured_quota_counts` 会用 `current_quota_count` 配置反推 total/remaining/used，并置 `UsageData.current_from_config` / `weekly_from_config = true`。**聚合时必须跳过 `from_config` 为真的 key**，否则凭空增加 used/total/remaining。新增此类反推时务必同步维护这两个标志与跳过逻辑。
3. **每 key 当前剩余硬上限**：单 key 视图 `selectRemainingDisplay` 约定"当前剩余不超过周剩余"。在 web 汇总中改为对每 key 取 `min(当前剩余, 周剩余)`，仅作用于当前周期，不要再切换成显示周剩余。
4. 修改 `UsageData` 结构体（state.rs）新增字段时，所有 `UsageData { ... }` 字面量（含 `api.rs` 错误分支、`tray.rs` 测试 `make_usage` 等）都必须补字段；新增字段加 `#[serde(default)]` 以免旧缓存反序列化失败。

## 构建后清理
每次 Release 构建完成后，运行 `cd src-tauri && cargo clean` 清理 `target/` 目录（可回收 2-4 GiB 磁盘空间），避免缓存膨胀占用 SSD 空间。
