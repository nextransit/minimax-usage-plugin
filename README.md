# MiniMax Monitor

[English](./README.md) | [简体中文](./README.zh-CN.md)

<p align="center">
  <img src="./images/icon.png" width="128" />
</p>

<p align="center">
  <strong>Multi API Keys · Smart Hover · Native Desktop</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=decard.minimax-monitor">
    <img src="https://img.shields.io/badge/VS%20Code-007ACC?style=flat-square&logo=visual-studio-code" alt="VS Code" />
  </a>
  <a href="https://github.com/nextransit/minimax-usage-plugin/releases/latest">
    <img src="https://img.shields.io/badge/Download-Desktop%20App-orange?style=flat-square" alt="Download Desktop" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-blue?style=flat-square" alt="Platform" />
</p>

---

## Privacy Notice

This extension only displays API key usage data. Your API keys are stored locally through VS Code Secret Storage or the operating system keychain and are not transmitted to any third-party service by this project.

---

## Features

### Native Desktop App

A standalone desktop application built with Tauri for macOS, Windows, and Linux. Features native tray integration, system notifications, and background auto-refresh so you can monitor usage without keeping VS Code open.

[Download from GitHub Releases →](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

![Desktop App](./images/screenshot-desktop.png)

### Multi API Key Management

Manage multiple API keys at the same time. The status bar shows independent `ALL / Key1 / Key2 / ...` capsules so you can switch between keys and view aggregated usage instantly.

![Multi API Key Management](./images/screenshot-multi-key.png)

### Friendly Long-Period Progress Bar

The weekly usage bar (the slowest-moving one) now ships with a brand-tinted translucent track, a 25% dashed scale, a subtle shimmer and breathing glow on the filled portion, and a "current time" marker that turns from green to amber when your usage is running ahead of the week. Even at 1% you can tell the system is alive, and you can tell at a glance whether you still have headroom for the week.

### Smart Hover Preview

Hover over the status bar to inspect used / used percentage data per key, with high-usage keys highlighted for quick review.

![Hover Preview](./images/screenshot-hover.png)

### Details Panel

Click the status bar entry to open the details panel and inspect current-window usage, weekly usage, per-model tables, and risk warnings.

![Details Panel](./images/screenshot-details.png)

### Status Bar Summary

The status bar shows the selected key's current usage percentage and can optionally include weekly usage progress.

![Status Bar](./images/screenshot-statusbar.png)

---

## Installation

### VS Code Extension

**Option 1: VS Code Marketplace**
1. Open VS Code.
2. Search for `MiniMax Monitor`.
3. Install the extension.

**Option 2: Open VSX**
- [open-vsx.org](https://open-vsx.org/extension/benpay/minimax-monitor)

**Option 3: Manual VSIX**
1. Download the latest `.vsix` package.
2. In VS Code, run `Extensions: Install from VSIX...` from `Ctrl/Cmd + P`.

### Desktop App

| Platform | Download |
|------|------|
| macOS (Apple Silicon / Intel) | [.dmg package](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Windows | [.exe package](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |
| Linux | [.AppImage / .deb / .rpm](https://github.com/nextransit/minimax-usage-plugin/releases/latest) |

[Open the latest GitHub Release page](https://github.com/nextransit/minimax-usage-plugin/releases/latest)

---

## Configuration

### VS Code Extension

1. Open the Command Palette with `Ctrl/Cmd + Shift + P`.
2. Run `MiniMax Monitor: Set API Key`.
3. Enter your MiniMax API key.
4. Press `Enter` to confirm.

Use `MiniMax Monitor: Add API Key` to manage multiple keys.

### Desktop App

1. Download and install the package for your platform.
2. Launch the app and add your API key on first run.
3. Manage multiple keys from the desktop UI or tray entry.

### Settings

| Setting | Default | Description |
|--------|--------|------|
| `minimaxUsage.refreshIntervalSeconds` | `60` | Auto-refresh interval in seconds |
| `minimaxUsage.showWeeklyInStatusBar` | `true` | Show weekly progress in the status bar |
| `minimaxUsage.detailModelLimit` | `8` | Maximum number of model rows in details |
| `minimaxUsage.statusBarAlignment` | `left` | Status bar alignment |
| `minimaxUsage.requestTimeoutMs` | `15000` | Request timeout in milliseconds |

---

## Commands

| Command | Description |
|------|------|
| `MiniMax Monitor: Show Details` | Open the details panel |
| `MiniMax Monitor: Set API Key` | Set the primary API key |
| `MiniMax Monitor: Add API Key` | Add another API key |
| `MiniMax Monitor: Refresh` | Refresh the current selection |
| `MiniMax Monitor: Refresh All Keys` | Refresh all active keys |
| `MiniMax Monitor: Switch API Key` | Switch the selected key |
| `MiniMax Monitor: Clear API Key` | Clear all saved keys |

---

## License

MIT. See [LICENSE](./LICENSE).

---

This project is for displaying MiniMax API key usage only. API keys stay in local secure storage.
