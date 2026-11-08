# Platform reading

English | [中文](agent-reach.zh.md)

The [Agent-Reach bundle](../../packages/experimental/agent-reach/README.md) exposes bounded platform reads through `ctx.agentReach`. Tools consume the execution service in the same plugin lifecycle; external prerequisites are acquired only by the separately approved setup tool.

## Read service

`AgentReachExecutionRequest` names a channel, action, optional exact backend and action parameters. Session-sensitive routes are rejected before executable lookup. `AgentReachResult` retains public item fields, access scope, content completeness, bounded attempt summaries and an optional `AgentReachError`.

`channels()` reads the checked-in `ChannelDefinition` catalog without starting a process. `status()` inspects installed prerequisites and returns cached doctor facts; it neither installs dependencies nor establishes current login or platform availability. The package README owns runtime installation, configuration, process ownership and supported platforms.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentreach--agentreachservice"></a>

### `ctx.agentReach` — `AgentReachService`

Shared platform-read service used by the model tools.

```ts cordis-catalog
/**
 * Run one validated read through the owned transient runtime.
 * @param request - Exact action, backend, inputs and cancellation.
 * @returns Bounded public result or an explicit refusal.
 */
query(request: AgentReachExecutionRequest): Promise<AgentReachResult>

/**
 * Inspect the local static action catalog without spawning.
 * @returns Checked-in channel definitions.
 */
channels(): Promise<{ ok: boolean; channels: readonly ChannelDefinition[] }>

/**
 * Inspect installed prerequisites without installing or logging in.
 * @param channel - Optional known platform filter.
 * @returns Bounded cached doctor facts or a setup diagnostic.
 */
status(channel?: string): Promise<{ ok: boolean; doctor?: unknown; version?: string | undefined; error?: AgentReachError | undefined }>
```

Source: [`packages/experimental/agent-reach/src/types.ts`](../../packages/experimental/agent-reach/src/types.ts)
<!-- END GENERATED cordis-surface -->
