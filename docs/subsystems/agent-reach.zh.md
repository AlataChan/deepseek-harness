# 平台内容读取

[English](agent-reach.md) | 中文

[Agent-Reach 扩展包](../../packages/experimental/agent-reach/README.zh.md) 通过 `ctx.agentReach` 提供有上限的平台内容读取。工具在同一插件生命周期内使用执行服务；外部依赖只由单独确认的安装工具获取。

## 读取服务

`AgentReachExecutionRequest` 指定平台、动作、可选的精确引擎和动作参数。访问账号会话的动作在查找可执行文件之前检查权限。`AgentReachResult` 保留公开条目字段、访问范围、内容完整性、有上限的尝试摘要和可选的 `AgentReachError`。

`channels()` 读取已提交的 `ChannelDefinition` 目录，不启动进程。`status()` 检查已安装的依赖并返回缓存的诊断信息；既不安装依赖，也不证明当前登录态或平台可访问。软件包 README 负责运行环境安装、配置、进程归属和支持的平台。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
