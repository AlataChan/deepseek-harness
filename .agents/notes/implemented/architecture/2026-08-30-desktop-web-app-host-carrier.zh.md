# Agent Note: octopus_DSH desktop rides the web-app Host

Status: implemented

[English](2026-08-30-desktop-web-app-host-carrier.md) | 中文

## Problem

octopus_DSH 是 Tauri 2 外壳加 Node companion。上游 0.1.2 删除了 `dsh-host-apiproxy` 和 `dsh-client-runtime`：Host API 变成 session/settings/workspace controller 上的 Typert `@Remote`，Client 启动图是官方 `client-connection` 消费的 `WebBootGraph`，`__ModuleLoader__` 由 `bootInjections()` 注入。仍然讲 ApiProxy 一元 RPC 的桌面 Host，或仍调用 `bundleRecords()` / `configureContext()` 的 WebView，都无法启动这套 Client。

## Decision

companion 跑的是 web-app Host。`PROFILE_TEMPLATES.desktop` 是 `base + web-app + desktop-app`。[`dsh-desktop-app`](../../../../packages/bundle/desktop-app/README.zh.md) 禁用 `web-startup`，让 commander 只接受 `--workspace-root`；`desktop-startup` 同时提供 `desktopStartup` 和 `webStartup`（`127.0.0.1`、端口 `0`、`openBrowser: false`、空 `trustedHosts`），这样 `webserver`、`web-runtime` 和 Connection 仍能解析。`web-runtime` 被覆盖为 `openBrowser: false` 与 `printUrl: false`。`connection-desktop` 只做 Host：它再导出 process-carrier 的 `apply`，不得再发布第二个 `dsh.client` 面。WebView 在 `AppWebEntry.run()` 之前设置 `globalThis.__DSH_TRANSPORT__`（`fetch`、`openStream`、`loadBundle`、`ownsHost: true`）；官方 `client-connection` 消费该对象。

进程载体是协议第 2 版。一元流量是携带 `client-request` | `server-response` 的 `rpc/message`。流是 `stream/open { streamId, endpoint, payload }`、`stream/frame { value }`，以及 opened/close/end/error。没有 `rpc/receipt`，没有 `client-response`，也没有 `mux|host` 流标签。`control/ready.graph` 是完整的 `WebBootGraph`（`rev`、`entries`、`batches`）。Host 通过 `clientPath(id)` 宣布每条 entry。bootstrap 装上与 `bootInjections()` 相同的 queue facade，把 combo batch flatten 成每条 entry 的缓存 `convertFileSrc` URL，只预载 `@deepseek-ai/dsh-client-modules`，再跑官方 web entry。

Fork overlay 继续走种子。官方 `desktop-app` 的 `cordis.patch.yml` 不点名 [`dsh-experimental-desktop-files`](../../../../packages/experimental/desktop-files/README.zh.md)。文件列举是官方 `session.listEntries`；overlay 只提供 Provider 和 `sidebar.files` 占座。见[文件工作台笔记](../feature/2026-08-28-desktop-file-workbench.zh.md)。

## Alternatives considered

**保留私有 ApiProxy Host 和桌面自有 Client runtime。** 否决：0.1.2 Client 模块要求 Typert remotes、`WebBootGraph` batches 和 `__DSH_TRANSPORT__`。重做这三面等于分叉整套 GUI。

**复用 `web-startup`，把它的 commander 语法加上 `--workspace-root`。** 否决：web-startup 已经拥有封闭的 flag 族；扩展后桌面 companion 会接受仅属于 web 的 flag，而且除非重写 web-runtime 的每一个 key，否则 `openBrowser` / 打印 URL 仍会留下。

**靠给 desktop-startup 行改名来发布 `webStartup`。** 否决：Cordis 的 `name` 是 patch 守卫。名字对不上就跳过该行。desktop-startup 里的 `ctx.provide('webStartup', …)` 才是后面 web 行等待的服务；insert 不必把 desktop-startup 排在 `webserver` 前面。

**继续用协议第 1 版（receipt、`client-response`、`mux|host`）。** 否决：0.1.2 的 `RpcMessage` 只有 `client-request` | `server-response`，Typert 流按 endpoint 寻址，不用 mux 标签。

**给 `connection-desktop` 再挂一个 `dsh.client` 面。** 否决：官方 `client-connection` 已经消费 `__DSH_TRANSPORT__`。第二个 client 插件会重复绑定同一批服务。`packages/client/*` 下没有 `dsh.client` 的包必须用 `staticLinked`；browser 面只有 `ProcessTransport`。

## Consequences

打包后的 companion 会在 loopback `127.0.0.1:0` 上监听，因为它就是 web-app Host。stdio 仍是 WebView 载体；窗口不对该端口发 HTTP。`scripts/desktop-profile-plugins.json` 的 `shippedBundles` 必须保持 `base + web-app + desktop-app`。生成的 `session-controller` remote 面缺少 `listEntries` 时，`verify-desktop-bundle.sh` 拒绝出 DMG。改 `@Remote` 方法后，打包前必须重打该 Typert 面。课期和问数 overlay 只走种子，不写进官方 `desktop-app` 组合。

## Testing

包测试钉死：desktop profile 模板、desktop-app 补丁（禁用 web-startup、双 startup 服务、仅 Host 载体）、协议 v2 codec/gateway、WebView bootstrap（安装 transport、flatten 后的图、只预载 modules）、侧栏 `sidebar.files` 占座，以及 `session.listEntries` 映射。`apps/cli/tests/desktop-companion.spec.ts` 用源码 companion 走 stdio。`apps/desktop/tests/assembled-handshake.spec.ts` 通过 Rust `carrier-harness` 驱动构建后的 companion。
