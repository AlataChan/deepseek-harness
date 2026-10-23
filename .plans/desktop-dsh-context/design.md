# Design: Seed dsh-context into octopus_DSH desktop

Date: 2026-08-28
Status: Approved

## Chosen Approach

路径：外挂 desktop profile 插件。不改官方 `PROFILE_TEMPLATES.desktop`、`dsh-desktop-app`、desktop companion 入口。DMG 嵌入预取的 npm 包；首次启动复制进 `$DSH_HOME/profiles/desktop`。

## Key Decisions

- Decision: 只融入 `dsh-context`，不融入 dsh-web / better-sidebar / dsh-TUI / dsh-find-plugin。理由：只有它的 Host 不依赖 `webServer`。
- Decision: 钉死 `dsh-context@0.36.0`，用 `scripts/desktop-profile-plugins.json` 做单一来源。
- Decision: 安装形态等同 `dsh plugin add`：profile `node_modules` 副本 + `dsh.profile.bundles` 追加。首次安装才追加；用户删掉 bundle 后刷新不写回。
- Decision: `verify-desktop-bundle.sh` 对嵌入副本跑同一校验器，失败不产出 DMG。
- Decision: 默认助理仍是 `standard`。上下文页是会话 UI，不是新的开机助理。

## Out of Scope (v1.0)

- better-sidebar / dsh-market 传输适配
- 把 `dsh-context` 写进官方 desktop-app 组合
- 首次启动联网 `pnpm add`
