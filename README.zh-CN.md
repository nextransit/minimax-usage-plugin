# MiniMax Monitor

[English](./README.md) | [简体中文](./README.zh-CN.md)

<p align="center">
  <img src="./images/icon.png" width="128" />
</p>

<p align="center">
  <strong>多 API Key · 智能悬停 · 桌面原生</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=decard.minimax-monitor">
    <img src="https://img.shields.io/badge/VS%20Code-007ACC?style=flat-square&logo=visual-studio-code" alt="VS Code" />
  </a>
  <a href="https://github.com/nextransit/minimax-usage-plugin/releases/latest">
    <img src="https://img.shields.io/badge/Download-Desktop%20App-orange?style=flat-square" alt="下载桌面版" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
</p>

---

## 隐私声明

本插件仅显示 API Key 的用量信息。您的 API Key 通过 VS Code Secret Storage 或操作系统 Keychain 本地安全存储，不对外传输。

---

## 核心功能

### 桌面版原生应用

基于 Tauri 构建的独立桌面应用，支持 macOS、Windows、Linux。提供原生系统托盘、系统通知和后台自动刷新，无需打开 VS Code 即可监控用量。

[从 GitHub Releases 下载 →](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

![桌面版](./images/screenshot-desktop.png)

### 多 API Key 管理

支持同时管理多个 API Key，在状态栏独立显示 `ALL / Key1 / Key2 / ...` 胶囊按钮，一键切换查看不同 Key 的用量，并实时汇总显示总用量。

![多 API Key 管理](./images/screenshot-multi-key.png)

### 长周期进度条更友好

面向消费缓慢的周额度进度条，我们做了视觉与节奏上的重做：底色改为品牌色透明渐变 + 25% 刻度虚线；已使用部分增加流光与右侧呼吸光晕，证明「系统在运转」；新增「当前时间点」指针（绿色 = 用量跑在时间之后，橙色 = 用量跑在时间之前），把「走得慢」转化为「额度充裕」的安心感。即使用量只到 1%，也能立刻分辨节奏。

### 智能悬停预览

鼠标悬停状态栏即可查看快速预览，按 Key 展示已用量 / 已用百分比，并高亮用量异常 Key。

![悬停预览](./images/screenshot-hover.png)

### 详情面板

点击状态栏打开详情面板，查看当前周期已用进度、本周已用进度、模型明细表格和风险预警提示。

![详情面板](./images/screenshot-details.png)

### 状态栏显示

状态栏实时显示当前选中 Key 的已用百分比，并可选显示本周已用进度。

![状态栏](./images/screenshot-statusbar.png)

---

## 安装

### VS Code 插件

**方式一：VS Code 市场**
1. 打开 VS Code。
2. 搜索 `MiniMax Monitor`。
3. 点击安装。

**方式二：Open VSX**
- [open-vsx.org](https://open-vsx.org/extension/benpay/minimax-monitor)

**方式三：手动安装 VSIX**
1. 下载最新 `.vsix` 文件。
2. 在 VS Code 中通过 `Ctrl/Cmd + P` 运行 `Extensions: Install from VSIX...`。

### 桌面版

| 平台 | 下载 |
|------|------|
| macOS (Apple Silicon / Intel) | [.dmg 安装包](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Windows | [.exe 安装包](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Linux | [.AppImage / .deb / .rpm](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |

[打开最新 GitHub Release 页面](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

---

## 配置

### VS Code 插件

1. 使用 `Ctrl/Cmd + Shift + P` 打开命令面板。
2. 运行 `MiniMax Monitor: Set API Key`。
3. 输入您的 MiniMax API Key。
4. 按 `Enter` 确认。

如需管理多个 Key，可使用 `MiniMax Monitor: Add API Key`。

### 桌面版

1. 下载并安装对应平台的安装包。
2. 首次启动后添加 API Key。
3. 在桌面 UI 或托盘入口中管理多个 Key。

### 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `minimaxUsage.refreshIntervalSeconds` | `60` | 自动刷新间隔（秒） |
| `minimaxUsage.showWeeklyInStatusBar` | `true` | 状态栏显示本周进度 |
| `minimaxUsage.detailModelLimit` | `8` | 详情面板最多显示的模型条数 |
| `minimaxUsage.statusBarAlignment` | `left` | 状态栏位置 |
| `minimaxUsage.requestTimeoutMs` | `15000` | 请求超时（毫秒） |

---

## 命令面板

| 命令 | 说明 |
|------|------|
| `MiniMax Monitor: Show Details` | 打开详情面板 |
| `MiniMax Monitor: Set API Key` | 设置主 API Key |
| `MiniMax Monitor: Add API Key` | 添加新的 API Key |
| `MiniMax Monitor: Refresh` | 刷新当前选中项 |
| `MiniMax Monitor: Refresh All Keys` | 刷新所有启用的 Key |
| `MiniMax Monitor: Switch API Key` | 切换当前选中 Key |
| `MiniMax Monitor: Clear API Key` | 清除所有已保存 Key |

---

## License

MIT，详见 [LICENSE](./LICENSE)。

---

本项目仅用于显示 MiniMax API Key 用量信息，API Key 始终保存在本地安全存储中。
