# host/ — 交互式客户端宿主侧

[English](README.md) | 中文

dsh 交互式客户端的宿主侧：传输无关的 API 网关，以及普通 HTTP 服务器等界面适配器。Client Plugin（客户端插件）侧位于 [`client/`](../client/README.md)；Web 应用由 [`apps/cli`](../../apps/cli/README.md) 启动 [`dsh-base`](../bundle/base/README.md)、[`dsh-client-app`](../bundle/client-app/README.md) 与 [`dsh-web-app`](../bundle/web-app/README.md)，并提供 [`apps/web`](../../apps/web/)。这些全是**产品**包。

| 包 | 职责 | ctx key |
|---|---|---|
| [`apiproxy/`](apiproxy/README.md) | 共享宿主 API 网关和协议约定 | `ctx.apiProxy` |
| [`webserver/`](webserver/README.md) | HTTP 路由载体 | `ctx.webServer` |
| [`client-modules-web/`](client-modules-web/README.md) | 共享 Client Plugin 注册表的 Web 路由和 index 注入 | 消费 `ctx.clientModules` 与 `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.md) | 占据 webserver 回退席位的 SPA dist 服务器 | 消费 `ctx.webServer` |
| [`directory-picker/`](directory-picker/README.md) | 工作区目录选择 seam | `ctx.directoryPicker` |
| [`directory-picker-native/`](directory-picker-native/README.md) | 原生目录选择器后端和浏览器交互 | 注册 `ctx.directoryPicker` |
| [`directory-picker-browse/`](directory-picker-browse/README.md) | 应用内目录浏览器后端和交互 | 注册 `ctx.directoryPicker` |
| [`directory-picker-auto/`](directory-picker-auto/README.md) | 宿主自适应选择器组合 | 挂载一个后端 |
| [`plugin-inventory/`](plugin-inventory/README.md) | 当前 Loader 条目的只读投影 | Remote `pluginInventory/list` |

`apiproxy` 与 [`client/modules`](../client/modules/README.md) 保持传输无关；`client-modules-web` 与 [`client/connection`](../client/connection/README.md) 提供各自的浏览器／HTTP 适配器。选择器实现可在共享 seam 后互相替换。

子系统参考：[web-server.md](../../docs/subsystems/web-server.md) 与 [workspace.md](../../docs/subsystems/workspace.md)（选择器 seam）。
