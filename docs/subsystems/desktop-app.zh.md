# 桌面运行时胶水层

[English](desktop-app.md) | 中文

由 [`@deepseek-ai/dsh-desktop-app`](../../packages/bundle/desktop-app/README.zh.md) 拥有的桌面运行时配置。`ctx.desktopStartup` 携带外壳在 Host 启动前解析出的值——用户选择的工作区根,以及是否注册对模型可见的桌面面朝向。外壳本身是 [`apps/desktop`](../../apps/desktop/README.md)。

来源：[`packages/bundle/desktop-app/src/startup.ts`](../../packages/bundle/desktop-app/src/startup.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopstartup--desktopstartupvalues"></a>

### `ctx.desktopStartup` — `DesktopStartupValues`

Immutable facts selected by the desktop shell for one companion process.

Source: [`packages/bundle/desktop-app/src/startup.ts`](../../packages/bundle/desktop-app/src/startup.ts)
<!-- END GENERATED cordis-surface -->
