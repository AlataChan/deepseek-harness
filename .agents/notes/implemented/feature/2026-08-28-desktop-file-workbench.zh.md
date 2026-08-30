# Agent Note: octopus_DSH desktop file workbench

Status: implemented

[English](2026-08-28-desktop-file-workbench.md) | 中文

## Problem

octopus_DSH 桌面用户需要在不离开对话栏的情况下看到当前会话的项目文件。官方 web 没有文件树。把树写进 `dsh-desktop-app` 或 `PROFILE_TEMPLATES.desktop`，会改掉这些官方包每一个消费者的随发行版桌面组合。directory-picker browse 只列文件夹，默认还是宿主家目录，不能当会话 cwd 文件树用。

## Decision

列举 seam 是官方的。[`@deepseek-ai/dsh-host-workspace-entries`](../../../../packages/host/workspace-entries/README.zh.md) 是 Service Definition（`ctx.workspaceEntries`）。官方 `session.listEntries` 是 Consumer：请求是 `{ sessionId, path? }`，从该会话的 `cwd` 推导 `root`（先看活着的 header，否则 `sessionPersistence.list()`；不为列文件去 resume agent，也不走 `inspectApiSession`），并把 `WorkspaceEntriesError` 映射为 `session/entries-unreadable` 或 `session/entries-outside-root`。客户端不能发送 `root`。服务缺失时失败为 `session/entries-unavailable`。点击文件走已有的 `session.openWorkspacePath`。

Provider 和 Client 树放在私有 overlay [`@deepseek-ai/dsh-experimental-desktop-files`](../../../../packages/experimental/desktop-files/README.zh.md)。它的补丁只插入一行 Host；`dsh.client` 发现 Client 面。Client 调用 `ctx.remote.session.listEntries` / `openWorkspacePath`，并用 `ctx.slots.inject('sidebar.files', …)` 注册。官方 `ui-sidebar` 声明 `sidebar.files` 孔位，以及占座 hook（`ctx.slots.entries` + `subscribe`，注入为 `useFilesOccupied`）。绘制「会话 / 文件」切换的是占座，不是 `renderSlot` 的真值；孔位为空时官方 web 保持原样。

路径篱笆：fully qualified；词法 containment（含 Windows 跨盘 `path.relative`）；`realpath` containment；`opendir(realPath)`。目录符号链接的 realpath 离开会话 cwd 时失败为 `session/entries-outside-root`，不会列举外面的树。没有应用内编辑器或预览。

种子沿用 [`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json)。overlay 是 `source: "workspace"`：把构建后的包树拷到 `node_modules/<package.json name>`（含 scoped 的 `@scope/name`），不用 `npm pack`。dest 若是 symlink 则拒绝。首次启动的 Tauri 安装读 `package.json` 的 name/version，并递归 `@` 目录。`verify-desktop-bundle.sh` 校验每一个 pin，并要求生成的 session-controller remote 面导出 `listEntries`。

该 overlay 所依附的桌面 Host 与 WebView 载体记在[web-app Host 笔记](../architecture/2026-08-30-desktop-web-app-host-carrier.zh.md)。官方 `desktop-app` 的 `cordis.patch.yml` 不点名 overlay。

## Alternatives considered

**把 overlay 加进 `dsh-desktop-app` 或 `PROFILE_TEMPLATES.desktop`。** 否决：这会改写每一个消费者的官方桌面组合，违背「课期 / overlay 不得改这些产品包」的 fork 约定。

**复用 directory-picker browse（`listDirectory`）。** 否决：该方法只列目录，默认是宿主家目录，属于选择器浏览约定，不是会话 cwd 文件树。

**用 `renderSlot('sidebar.files')` 的真值来画「文件」。** 否决：`renderSlot` 总会返回 `<SlotOutlet>` 包装，官方 web 空孔位也会出现页签。

**让客户端发送 `root`。** 否决：客户端可以列到会话 cwd 外面。篱笆由宿主拥有，并从 `sessionId` 推导 root。

**缺 cwd 时走 `inspectApiSession`。** 否决：该路径把没有 cwd 的会话报成 not-found，冷的空白会话会看起来像不存在，而不是不可读。

**线码继续用不带前缀的 `entries-*`。** 否决：0.1.2 Remote 码是 `<domain>/<reason>`，并且只活在一张 `RemoteErrorDetailsMap` 里。Provider 进程内仍抛不带前缀名的 `WorkspaceEntriesError`；只有 Consumer 的线码带 `session/` 前缀。

**对 workspace overlay 跑 `npm pack`。** 否决：overlay 是未发布的私有包；种子拷构建后的树。

## Consequences

完成种子的 octopus_DSH 桌面 profile 会加载 overlay，并显示「会话 / 文件」。官方 web 默认组合不显示「文件」。用户从 bundles 去掉该名称后，之后的种子刷新也保持去掉。嵌入 overlay 缺失、不是可加载的 `dsh.bundle` + `dsh.client` 包、或 session-controller remote 面缺少 `listEntries` 时，`verify-desktop-bundle.sh` 拒绝出 DMG。仍然没有编辑器、预览、终端、Git 面板或浮窗。WebView 通过 `__DSH_TRANSPORT__` 讲 Typert remotes；给 session-controller 加的 Host `@Remote`，要重打生成的 remote 面之后窗口里才看得到。

## Testing

包测试覆盖：SD invariant、`session.listEntries` 映射（活 cwd、persistence list、能力缺失、出界、中止）、列举篱笆（含 win32 `relative` 与 realpath 出界）、侧栏占座的 register/dispose、FileTree 在切换会话时中止、以及 scoped / symlink 种子。官方 web 默认快照不得出现「文件」。
