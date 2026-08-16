# host/ — interactive-client host half

English | [中文](README.zh.md)

The host side of interactive dsh clients: the transport-neutral API gateway plus surface adapters such as the plain HTTP server. The Client Plugin side lives in [`client/`](../client/README.md); the Web application is [`apps/cli`](../../apps/cli/README.md) booting [`dsh-base`](../bundle/base/README.md), [`dsh-client-app`](../bundle/client-app/README.md), and [`dsh-web-app`](../bundle/web-app/README.md) to serve [`apps/web`](../../apps/web/). All **product** packages.

| Package | Role | ctx key |
|---|---|---|
| [`apiproxy/`](apiproxy/README.md) | Shared host API gateway and wire contract | `ctx.apiProxy` |
| [`webserver/`](webserver/README.md) | HTTP route carrier | `ctx.webServer` |
| [`client-modules-web/`](client-modules-web/README.md) | Web routes and index injection for the shared Client Plugin registry | consumes `ctx.clientModules` and `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.md) | SPA dist server on the webserver fallback seat | consumes `ctx.webServer` |
| [`directory-picker/`](directory-picker/README.md) | Workspace-directory picking seam | `ctx.directoryPicker` |
| [`directory-picker-native/`](directory-picker-native/README.md) | Native directory-picker backend and browser interaction | registers `ctx.directoryPicker` |
| [`directory-picker-browse/`](directory-picker-browse/README.md) | In-app directory-browser backend and interaction | registers `ctx.directoryPicker` |
| [`directory-picker-auto/`](directory-picker-auto/README.md) | Host-adaptive picker composition | mounts a backend |
| [`plugin-inventory/`](plugin-inventory/README.md) | Read-only projection of current Loader entries | Remote `pluginInventory/list` |

`apiproxy` and [`client/modules`](../client/modules/README.md) remain transport-independent; `client-modules-web` and [`client/connection`](../client/connection/README.md) supply their browser/HTTP adapters. Picker implementations replace one another behind the shared seam.

The subsystem references: [web-server.md](../../docs/subsystems/web-server.md) and [workspace.md](../../docs/subsystems/workspace.md) (the picker seam).
