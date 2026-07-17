# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述 (Project Overview)

本仓库包含两个相关项目：

| 项目 | 路径 | 技术栈 |
|------|------|--------|
| VS Code 插件 | `src/`, `package.json` | TypeScript, VS Code API |
| 独立桌面应用 | `src-tauri/`, `src-web/` | Rust (Tauri v2), HTML/CSS/JS |

当前开发重点在 **Tauri 独立桌面应用**，VS Code 插件功能已稳定。

---

## Tauri 桌面应用

### 技术栈

- **后端**: Rust + Tauri v2
- **前端**: 原生 HTML/CSS/JS (无框架，Cyberpunk 风格)
- **状态管理**: `AppState` (Rust Mutex) + Tauri Events (frontend ↔ backend 通信)
- **存储**: `keyring v3` native backends (macOS Keychain / Linux Secret Service / Windows Credential Manager) 存储 API Key，`dirs` crate 存储配置文件并保留 fallback 文件
- **插件**: `tauri-plugin-autostart`, `tauri-plugin-notification`, `tauri-plugin-shell`

### 核心模块

```
src-tauri/src/
├── lib.rs          # 应用入口，tauri::Builder 配置，setup 逻辑
├── main.rs         # 入口点，调用 lib::run()
├── commands.rs     # Tauri 命令 (cmd_* 前缀)，frontend 调用入口
├── state.rs        # AppState, AppConfig, UsageData 结构体
├── config.rs       # 配置文件加载/保存 (JSON)
├── api.rs          # MiniMax API 请求逻辑
├── api_key_store.rs # Keychain API Key 存储
├── tray.rs         # 系统托盘菜单管理
└── notifications.rs # 额度预警通知
```

### 前端文件

```
src-web/
├── index.html  # 主界面布局
├── styles.css # Cyberpunk 风格样式
└── app.js     # Tauri API 调用，i18n
```

### 构建命令

```bash
# 开发模式运行 Tauri
npm run tauri:dev

# Release 构建
npm run tauri:build

# CI/unsigned release 构建
npm run tauri:build:ci

# 清理 Rust 构建缓存（Release 构建后回收磁盘空间）
cd src-tauri && cargo clean
```

### 构建后清理规范

每次 Release 构建完成后，运行 `cd src-tauri && cargo clean` 清理 `target/` 目录（可回收 2-4 GiB 磁盘空间），避免缓存膨胀占用 SSD 空间。

### 状态流向

```
Frontend (app.js) ←→ Tauri Commands (commands.rs) ←→ AppState (state.rs)
                                                    ↓
                                              各模块 (api, tray, config...)
```

### 关键设计

- **窗口关闭行为**: 点击关闭按钮隐藏到托盘，而非退出应用
- **首次运行**: 显示主窗口引导设置 API Key
- **托盘菜单**: 动态更新显示使用率、剩余额度、模型信息
- **语言**: 支持 zh-CN / en，自动检测系统语言

---

## VS Code 插件

### 技术栈

- **后端**: TypeScript
- **前端**: VS Code Webview (原生 HTML/CSS)
- **存储**: VS Code Secret Storage

### 构建命令

```bash
# 编译 TypeScript
npm run compile

# 打包 VSIX
npm run package
```

---

## 通用配置

### API Endpoint

```
GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains
```

### 配置文件位置

- **macOS**: `~/Library/Application Support/minimax-usage-monitor/`
- **Linux**: `~/.config/minimax-usage-monitor/`
- **Windows**: `%APPDATA%\\minimax-usage-monitor\\`

---

## 最近开发 (2026-04)

- 核心功能已完成并可运行
- 正在完善: macOS/Linux/Windows 跨平台打包与 CI artifacts
