# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

[`dsh-web-app`](../web-app/README.zh.md) 之上的桌面表面包。它保留 web Host（Typert remotes、Connection、loopback webserver），让 Client 模块能组装启动图；禁用 `web-startup`，使 `--workspace-root` 成为唯一接受的参数；并由 `desktop-startup` 发布 `webStartup`（`127.0.0.1`、端口 `0`、不打开浏览器）。它禁用 `client-hmr`，因为 Tauri WebView 会拒绝 web 的 EventSource 通道。WebView 安装 `__DSH_TRANSPORT__`，官方 `client-connection` 插件消费它。`connection-desktop` 只做 Host。

[`src/startup.ts`](src/startup.ts) 拥有 companion 的唯一参数 `--workspace-root <path>`。该值必须是绝对路径，并以 `ctx.desktopStartup` 提供；runtime 与 carrier 行在读取前注入该服务。Tauri 外壳负责进程发现、独占 home 租约，以及对外发布的 companion 入口。

## 模型体验

### 桌面表面上下文

#### 模型看到什么

当 `surfaceContext` 为 true 时，`harness:source` 段标明 Harness 实现检出，`app:desktop-surface` 段标明 dsh 桌面应用、所选工作区根，以及通过 Host 平台打开器打开被请求文件的指令。当 `surfaceContext` 为 false 时，这两段都不会注册。

#### Token 影响

每个会话一行来源说明和一段简短的表面取向段落；对 companion 进程而言是常量。

#### KV Cache 影响

两段都靠近系统提示词头部，并且使用启动时不可变的工作区，因此跨轮次保持稳定。

## 已知限制与暂缓事项

- **仅启动时工作区** — 更改根会重载 WebView；Client 的 directory-picker 行不会改 `--workspace-root`。
- **单窗口** — 没有多窗口、托盘、深链、原生对话框或编辑器上下文。
