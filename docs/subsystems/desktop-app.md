# Desktop Runtime Glue

English | [中文](desktop-app.zh.md)

The desktop runtime configuration owned by [`@deepseek-ai/dsh-desktop-app`](../../packages/bundle/desktop-app/README.md). `ctx.desktopStartup` carries the values the shell resolved before the Host boots — the workspace root the user selected and whether model-visible desktop surface orientation is registered. The shell itself is [`apps/desktop`](../../apps/desktop/README.md).

Source: [`packages/bundle/desktop-app/src/startup.ts`](../../packages/bundle/desktop-app/src/startup.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdesktopstartup--desktopstartupvalues"></a>

### `ctx.desktopStartup` — `DesktopStartupValues`

Immutable facts selected by the desktop shell for one companion process.

Source: [`packages/bundle/desktop-app/src/startup.ts`](../../packages/bundle/desktop-app/src/startup.ts)
<!-- END GENERATED cordis-surface -->
