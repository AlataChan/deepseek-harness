# 终端客户端

[English](tui.md) | 中文

[`dsh-tui`](../../packages/ui/tui/README.md) 包是在一个进程内 Agent 之上的仅限 Node 交互式呈现。[`dsh-tui-app`](../../packages/bundle/tui-app/README.md) bundle 解析应用参数，并在终端 row 挂载前发布启动值。

启动服务携带三种模式之一：带可选初始任务的新 Session、有数量上限的恢复选择器，或一个准确的已持久化 Session id。它是内部组合数据，不是 Remote API。

生命周期事件携带准确的 controller、存在时的当前 Agent，以及交互 provider 是否已经发布。包 invariant 观察这些事件，验证 TUI 插件创建和释放的关系；产品扩展应改用 Agent、Session、审批、问题与命令服务。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtuistartup--tuistartupservice"></a>

### `ctx.tuiStartup` — `TuiStartupService`

Service fields published for the TUI row after application arguments parse.

Source: [`packages/bundle/tui-app/src/startup.ts:22`](../../packages/bundle/tui-app/src/startup.ts)

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

Source: [`packages/ui/tui/src/index.ts:82`](../../packages/ui/tui/src/index.ts)

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

Source: [`packages/ui/tui/src/index.ts:76`](../../packages/ui/tui/src/index.ts)
<!-- END GENERATED cordis-surface -->
