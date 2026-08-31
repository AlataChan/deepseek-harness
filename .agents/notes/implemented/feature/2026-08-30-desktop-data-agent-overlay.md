# Agent Note: octopus_DSH desktop data-agent overlay

Status: implemented

English | [中文](2026-08-30-desktop-data-agent-overlay.zh.md)

## Problem

Users need a SQLite-first「问数」path on octopus_DSH without rewriting official `desktop-app` composition. `@yejiming/dsh-data-agent@0.1.3` is a real DSH overlay (preset 数据模式, SQL/Catalog tools, Web workbench). Copying only the tarball leaves `schemastery` / `zod` / ECharts unresolved. `dsh-context@0.36.0` imports `settingsNamespace` from `@deepseek-ai/dsh-settings`, which 0.1.2 no longer exports, so seeding it makes the second companion boot fail.

## Decision

The pin in [`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json) is file-workbench plus `@yejiming/dsh-data-agent@0.1.3`. Official `desktop-app` and `PROFILE_TEMPLATES.desktop` do not name it. `dsh-context` is not seeded. The desktop entry users click is the ask-data overlay; this note still owns only the data-agent pin.

[`scripts/seed-desktop-profile-plugin.mjs`](../../../../scripts/seed-desktop-profile-plugin.mjs) `npm pack` uses the unscoped tarball name (`@scope/name` → `scope-name-version.tgz`). After copy, an npm pin with `dependencies` gets a production install: the published `devDependencies` / `peerDependencies` are stripped for that install only, then the original `package.json` is restored. The install must not materialize `node_modules/@deepseek-ai`. Profile install copies that production `node_modules` when it is a real directory without `.pnpm`. Workspace pins still skip `node_modules`.

Host injects `agentPresets`, so the desktop profile can mount the plugin; headless cannot. Connections other than SQLite and ClickHouse HTTP need a CLI on the machine. The plugin's optional `dsh-client-runtime` inject is skipped when that package is absent from the 0.1.2 graph.

## Alternatives considered

**Rewrite data-agent into `packages/`.** Rejected: it is a maintained community overlay with its own Catalog, clients, and preset. The fork rule keeps course/community work off official desktop composition.

**Seed `dsh-context@0.36.0` next to data-agent.** Rejected: empty-home first handshake succeeds before first-launch copies overlays; the next boot imports `settingsNamespace` and the tree fails to load.

**`npm install --omit=dev` inside the fetched package.** Rejected: npm drops a production dep that is also listed under `devDependencies` (`schemastery`).

**Leave production deps to `dsh plugin add` only.** Rejected: first-launch copies the seed tree and never runs pnpm; a dep-less copy fails loud at apply.

## Consequences

A new DMG user gets 数据模式 after first launch if `sqlite3` is on the Mac. MySQL/Postgres/Oracle stay unavailable until the matching CLI exists. Existing `~/.dsh/profiles/desktop` that already lists `dsh-context` must drop that bundle or the companion will not boot on 0.1.2.
