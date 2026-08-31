# Agent Note: Heal leftover 0.1.1 desktop profile rows on 0.1.2

Status: implemented

[English](2026-08-30-desktop-leftover-profile-heal.md) | 中文

## Problem

跑过 0.1.1 octopus_DSH 的机器会把 `~/.dsh/profiles/desktop` 留成 `@deepseek-ai/dsh-client-app`，本 fork 还会留下 `dsh-context`。合入 0.1.2 之后，`dsh-base` 拥有 `id: storage`，桌面模板是 `dsh-base` + `dsh-web-app` + `dsh-desktop-app`。`normalizeShippedProfile` 只改写完全等于安装自有元组的名单，带额外 overlay 的 profile 永远不迁移。残留的 `dsh-client-app@0.1.1-rc.5` 仍在 `~/.dsh/profiles/node_modules`，并且也注册 `storage`。新 companion 在 apply 时报 `duplicate loader entry id: storage`，窗口到不了 ready。

## Decision

每次加载 profile 都会把 `@deepseek-ai/dsh-client-app` 改写成 `@deepseek-ai/dsh-web-app` 并写回清单，包括仍带用户额外 bundle 的名单。fork 的首次启动和 `scripts/seed-desktop-profile-plugin.mjs` 做同样改写，并从 `bundles` / `dependencies` 去掉 `dsh-context`。首次启动的随附元组是 `dsh-base` + `dsh-web-app` + `dsh-desktop-app`。`verify-desktop-bundle.sh` 拒绝仍点名 `dsh-client-app` 的 pin 或随附元组，并先愈合一份脏 fixture 再放行。

官方 companion 产品逻辑不变。`dsh-desktop-app` 会禁用 `client-hmr`，因为 Tauri WebView 会拒绝 web 的 EventSource 通道（`The operation is insecure`），否则窗口停在 Failed to load plugins。问数 workspace 钉会安装 `exceljs` 这类第三方依赖，避免首次启动覆盖后 Host apply 失败。

## Alternatives considered

**把残留 profile 留给用户自己改。** 否决：0.1.2 companion 起不来，用户到不了能解释怎么改的界面。

**只改写完全等于 `base + client-app + desktop-app` 的元组。** 否决：本 fork 的现场 profile 一定带额外 overlay，坏的正是这份名单。

**把去掉 `dsh-context` 放进官方 `app-boot`。** 否决：那是 fork 自己留下的 overlay。官方加载只改写已更名的安装 bundle。

## Consequences

在 0.1.1 桌面 profile 上打开 0.1.2 companion 时，会在 loader 解析 bundle 之前把 `dsh-client-app` 写成 `dsh-web-app`，因此 `storage` 只注册一次。首次启动还会去掉 `dsh-context`。desktop-files 这类额外 overlay 保留。脏 fixture 愈合是 `verify-desktop-bundle.sh` 的一部分。
