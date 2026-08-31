# Agent Note: octopus_DSH desktop data-agent overlay

Status: implemented

[English](2026-08-30-desktop-data-agent-overlay.md) | 中文

## Problem

octopus_DSH 需要一条 SQLite 优先的问数路径，且不能改官方 `desktop-app` 组合。`@yejiming/dsh-data-agent@0.1.3` 是现成的 DSH overlay（preset「数据模式」、SQL/Catalog 工具、Web 工作台）。只拷 tarball 会缺 `schemastery` / `zod` / ECharts。`dsh-context@0.36.0` 从 `@deepseek-ai/dsh-settings` 进口 `settingsNamespace`，0.1.2 已无此导出，种子它会让 companion 第二次启动失败。

## Decision

[`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json) 的钉是文件工作台加 `@yejiming/dsh-data-agent@0.1.3`。官方 `desktop-app` 和 `PROFILE_TEMPLATES.desktop` 不点名它。不再种子 `dsh-context`。用户点的桌面入口是问数 overlay；本笔记仍然只拥有 data-agent 钉。

[`scripts/seed-desktop-profile-plugin.mjs`](../../../../scripts/seed-desktop-profile-plugin.mjs) 的 `npm pack` 使用去 `@` 的 tarball 名（`@scope/name` → `scope-name-version.tgz`）。拷贝后，带第三方 `dependencies` 的钉会做一次生产安装：仅在安装期间去掉 `workspace:` 规格、`devDependencies` 和 `peerDependencies`，然后恢复原来的 `package.json`。安装结果不得出现 `node_modules/@deepseek-ai`。写入 profile 时，若生产 `node_modules` 是不含 `.pnpm` 的真目录则一并拷贝。只点名 `workspace:` peer 的 workspace 钉仍跳过 `node_modules`。

Host inject 需要 `agentPresets`，所以 desktop profile 能挂上，headless 不能。除 SQLite 和 ClickHouse HTTP 外，其它库要本机有对应 CLI。插件可选的 `dsh-client-runtime` inject 在 0.1.2 图里不存在该包时会被跳过。

## Alternatives considered

**把 data-agent 重写进 `packages/`。** 否决：这是带 Catalog、连接器和 preset 的社区 overlay。fork 规则要求课期/社区工作不改官方桌面组合。

**把 `dsh-context@0.36.0` 和问数一起种子。** 否决：空 home 第一次握手发生在 first-launch 拷 overlay 之前；下一次启动进口 `settingsNamespace`，整棵树加载失败。

**在已拉取的包里跑 `npm install --omit=dev`。** 否决：同时出现在 `devDependencies` 里的生产依赖会被丢掉（`schemastery`）。

**生产依赖只交给 `dsh plugin add`。** 否决：首次启动只拷种子树、不跑 pnpm；没有依赖的副本会在 apply 时响亮失败。

## Consequences

新 DMG 用户在本机有 `sqlite3` 时，首次启动后会有「数据模式」。MySQL/Postgres/Oracle 要本机已有对应 CLI。仍列出 `dsh-client-app` 或 `dsh-context` 的 `~/.dsh/profiles/desktop` 会在加载和首次启动时被改写（[残留 profile 愈合](../bug-fix/2026-08-30-desktop-leftover-profile-heal.zh.md)）。
