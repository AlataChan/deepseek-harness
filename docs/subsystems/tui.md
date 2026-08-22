# Terminal Client

English | [中文](tui.zh.md)

The [`dsh-tui`](../../packages/ui/tui/README.md) package is the Node-only interactive presentation over one in-process Agent. The [`dsh-tui-app`](../../packages/bundle/tui-app/README.md) bundle parses application arguments and publishes the startup value before the terminal row mounts.

The startup service carries one of three modes: a fresh Session with an optional initial task, the bounded resume selector, or one exact persisted Session id. It is internal composition data, not a Remote API.

The lifecycle events carry the exact controller, its current Agent when present, and whether the interaction providers were published. The package invariant observes these events to verify the relationship created and disposed by the TUI plugin; product extensions should use the Agent, Session, approval, question, and command services instead.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtuistartup--tuistartupservice"></a>

### `ctx.tuiStartup` — `TuiStartupService`

Service fields published for the TUI row after application arguments parse.

Source: [`packages/bundle/tui-app/src/startup.ts`](../../packages/bundle/tui-app/src/startup.ts)

<a id="tui-events"></a>

### `tui/*` events

<a id="tuicontroller-disposed--emit"></a>

#### `tui/controller-disposed` — emit

The same TUI-owned relation completed disposal.

```ts cordis-catalog
/**
 * The same TUI-owned relation completed disposal.
 * @mode emit
 * @param lifecycle - exact disposed relation.
 */
'tui/controller-disposed'(lifecycle: TuiControllerLifecycle): void
```

Source: [`packages/ui/tui/src/index.ts`](../../packages/ui/tui/src/index.ts)

<a id="tuicontroller-mounted--emit"></a>

#### `tui/controller-mounted` — emit

A TUI controller and its interaction providers became live.

```ts cordis-catalog
/**
 * A TUI controller and its interaction providers became live.
 * @mode emit
 * @param lifecycle - exact published relation.
 */
'tui/controller-mounted'(lifecycle: TuiControllerLifecycle): void
```

Source: [`packages/ui/tui/src/index.ts`](../../packages/ui/tui/src/index.ts)
<!-- END GENERATED cordis-surface -->
