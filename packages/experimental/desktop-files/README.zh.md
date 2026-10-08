---
description: "octopus_DSH 桌面文件树 overlay：ctx.workspaceEntries 后面带围栏的单层目录列举，以及 sidebar.files 的 Client 占座。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-files

[English](README.md) | 中文

## 概述

`desktop-files` 是会话 `cwd` 文件树的私有桌面 overlay：Host 半面用 fully-qualified、词法与 `realpath` 三重围栏实现 `ctx.workspaceEntries`，Client 半面占用 `sidebar.files`。点击文件经 `session.openWorkspacePath` 打开；没有应用内编辑器、Git 或终端界面。

octopus_DSH 私有 overlay：[`ctx.workspaceEntries`](../../host/workspace-entries/README.zh.md) 的 Provider，以及 `sidebar.files` 的 Client 占座。官方 `dsh-desktop-app` 和 `PROFILE_TEMPLATES.desktop` 都不点名这个包。桌面 profile 种子从构建后的包树拷贝（[scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 里 `source: "workspace"`）。

Host 默认导出是 `DesktopWorkspaceEntries`。`list({ root, path? }, signal)` 在 `root` 内列举一层目录。篱笆包括：路径必须 fully qualified、词法 containment（含 Windows 跨盘 `path.relative`）、以及 `realpath` containment；`opendir` 打开的是规范目录。一层最多 `config.maxEntries`（默认 1000）条，超出则 `truncated`。名称 `{ node_modules, .git, dist, coverage }` 会被跳过。目录符号链接的 `realpath` 离开 `realpath(root)` 时失败为 `entries-outside-root`，不会列举外面的树。

Client 面通过 `ctx.slots.inject('sidebar.files', …)` 注册。树的根是当前会话 `cwd`，走 `session.listEntries({ sessionId, path? })`——客户端从不发送 `root`。点击文件调用 `session.openWorkspacePath`。损坏的符号链接保持红色且不打开。隐藏行只在客户端过滤。官方 web 让 `sidebar.files` 保持空；绘制「会话 / 文件」切换的是占座（不是 `renderSlot` 的真值）。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## 配置

```yaml
- id: desktop-files
  name: '@deepseek-ai/dsh-experimental-desktop-files'
  config:
    maxEntries: 1000
```

`cordis.patch.yml` 插入这一行 Host，并重写 `connection-desktop`，让它也 inject `sessionController`。握手会等到 Session control stream 有活服务；否则第一次打开 `session/control` 会让 companion 退出，窗口永远重连。Client 半侧在 Host fiber 活着之后由 `dsh.client` 发现。

<a id="model-experience"></a>
## 模型体验

无。该 overlay 服务于 GUI 文件树；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **没有应用内编辑器或预览**——点击文件使用系统默认应用。
- **没有 Git、终端或浮窗**——v1 只做会话 cwd 树。

<a id="dev-note"></a>
## 开发备注

围栏是三重检查合一：路径 fully-qualified、词法 containment、`realpath` containment；目录符号链接一旦离开根，必须以 `entries-outside-root` 失败，而不是列举外面的树。`cordis.patch.yml` 还重写 `connection-desktop` 行以注入 `sessionController`；去掉这条重写，companion 会在第一次打开 `session/control` 时退出，窗口永远重连。
