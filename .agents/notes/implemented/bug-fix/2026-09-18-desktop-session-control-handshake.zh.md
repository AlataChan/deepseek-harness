# Agent Note: Wait for sessionController before desktop handshake

Status: implemented

[English](2026-09-18-desktop-session-control-handshake.md) | 中文

## Problem

octopus_DSH 默认 `workspaceRoot` 是用户家目录。`connection-desktop` 在 `connection`、`clientModules`、`typertGateway` 一就绪就回答 `control/ready`。WebView 接着打开 `session/control`。这条 stream 要找活的 `sessionController` 服务。`sessionController` inject `workspaceRegistry`，而 workspace 插件对着 `$HOME` 启动时它还在 pending。companion 把缺失服务当成 `gateway-failure` 并退出。窗口重连、再拉起 companion，再次输掉竞态。客户端可见错误是包在这次 companion 死亡外面的 `agentTeams/listInstitutionSquads`。

## Decision

已种子的 desktop-files overlay 重写官方 `connection-desktop` 行，让它也 inject `sessionController`，并重写 `workspaceRoot: !!js ctx.desktopStartup.workspaceRoot`。握手必须等到 Session Controller 提供之后才能完成。官方 `apps/desktop`、`dsh-desktop-app`、desktop-companion 保持不动。`verify-desktop-bundle.sh` 要求源码和打进 profile-plugin 的副本都带这一行 inject。

## Alternatives considered

**改官方 `packages/bundle/desktop-app/cordis.patch.yml`。** 否决：课期包和 overlay 不得改官方 desktop-app 产品组合。这个 inject 放在每条 octopus_DSH profile 已经会加载的种子 overlay 上。

**在官方 `connection-process` 里接住 `openStream` 失败，而不是 `fail('gateway-failure')`。** 这次不采用：那是官方 companion 网关行为；除非握手等待，否则重连的客户端仍会在服务出现之前打开 `session/control`。

**保持握手，只在 Agent Team UI 重试 `session/control`。** 否决：control stream 由官方 Session Controller Client 打开，不是小队行打开的。一元的 `listInstitutionSquads` 错误只是 companion 已经退出之后 Hero 碰巧显示的内容。

**为延迟 ready 再做一个新 overlay 包。** 否决：desktop-files 已经是第一个种子 dual-face bundle，而且 `session.listEntries` 已经依赖活的 `sessionController`。

## Consequences

工作区是 `$HOME` 的首次启动会停在连接中，直到 `sessionController` 活着，然后 control stream 才能打开。用户从 bundles 去掉 desktop-files 后，重连循环会回来。官方 web 与 headless profile 不变。

## Testing

包测试 `packages/experimental/desktop-files/tests/connection-ready.spec.ts` 读 `cordis.patch.yml`，要求带 `sessionController` inject 以及重写后的 `workspaceRoot` 表达式。`verify-desktop-bundle.sh` 对源码补丁和种子 `profile-plugins` 副本做同一检查。
