---
description: "dsh-web-app 之上的桌面表面包：Typert remotes、loopback web Host，以及 companion 唯一的 --workspace-root 参数。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

## 概述

`desktop-app` 是 [`dsh-web-app`](../web-app/README.zh.md) 之上的桌面表面包：为 Tauri WebView 保留 web Host，禁用 `web-startup` 与 `client-hmr`，并由 `desktop-startup` 在 `127.0.0.1:0` 发布 `webStartup`，不打开浏览器。companion 只接受一个参数 `--workspace-root <path>`，由 [`src/startup.ts`](src/startup.ts) 负责，runtime 与 carrier 行读取前将其注入为 `ctx.desktopStartup`。Tauri 外壳负责进程发现、独占 home 租约，以及对外发布的 companion 入口。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="model-experience"></a>
## 模型体验

### 桌面表面上下文

#### 模型看到什么

当 `surfaceContext` 为 true 时，`harness:source` 段标明 Harness 实现检出，`app:desktop-surface` 段标明 dsh 桌面应用、所选工作区根，以及通过 Host 平台打开器打开被请求文件的指令。当 `surfaceContext` 为 false 时，这两段都不会注册。

#### Token 影响

每个会话一行来源说明和一段简短的表面取向段落；对 companion 进程而言是常量。

#### KV Cache 影响

两段都靠近系统提示词头部，并且使用启动时不可变的工作区，因此跨轮次保持稳定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅启动时工作区** — 更改根会重载 WebView；Client 的 directory-picker 行不会改 `--workspace-root`。
- **单窗口** — 没有多窗口、托盘、深链、原生对话框或编辑器上下文。

<a id="dev-note"></a>
### 开发备注

本 bundle 是桌面 companion 唯一受支持的启动组合：`--workspace-root` 必须为绝对路径，并以 `ctx.desktopStartup` 提供；runtime 与 carrier 行在读取前注入该服务。保持 `web-startup` 禁用（`--workspace-root` 是唯一参数）与 `client-hmr` 禁用（Tauri WebView 拒绝 web EventSource 通道）；`surfaceContext: true` 会加入两段系统提示词头部的说明。
