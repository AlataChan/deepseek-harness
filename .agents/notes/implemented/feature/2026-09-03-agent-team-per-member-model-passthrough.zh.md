# Agent Note: Agent Team 每位成员的 provider 与模型透传

Status: implemented

[English](2026-09-03-agent-team-per-member-model-passthrough.md) | 中文

## 问题

Agent Teams 接受一个 teammate `provider`（子代理后端），但不接受每位成员的 `provider`/`model`/`reasoningEffort`。agent-team 的 spawn 只把 `{ prompt, parent }` 传给 `startContinuable`（`roster.ts:281`），所以 teammate 永远继承 Lead 的 Agent 选项。subagent 层本就支持子 Agent `AgentOptions`：`SubagentCapabilities.agentOptions` 是门禁（`subagent/src/types.ts:127`），`resolveChildAgentOptions` 将解析出的路由写入可恢复的 `subagent/descriptor`，字段为 `agentProvider`/`agentModel`/`agentReasoningEffort`（`continuation.ts:421-434`、`descriptor.ts:72-86`），冷恢复从该 descriptor 重建 Agent 选项（`continuation.ts:989-995`）。缺口完全在 Team 侧：它从未把 `agentOptions` 透传下去。

## 决策

`SpawnTeammateRequest` 携带 `agentOptions?: AgentOptions`，agent-team roster 将其透传给 `startContinuable({ request: { prompt, parent, agentOptions } })`。`spawn_teammate` 工具暴露可选的 `provider`、`model` 与 `reasoning_effort` 参数，并把它们转换成这些 `agentOptions`。

Team runtime 在 `context: 'fork'` 且收到 `agentOptions` 时，用 `TeamError(..., 'TEAM_FORK_NO_ROUTE_OVERRIDE')` 拒绝。`context: 'fork'` 意为子 Session 播种 Lead 的已完成对话前缀，改变 provider 或 model 会放弃 provider 侧 KV-cache 复用（[模型选择的子代理路由](2026-08-18-model-selected-subagent-routes.zh.md)）。已发布的 fork 工具出于同样原因保持路由选择关闭。

Team spawn 执行器针对调用方 Lead Session 已记录的 `subagent/model-selection-policy` 强制执行用户授权允许列表，并复用来自 `dsh-tool-subagent` 的 `assertAllowedModelSelection`。spawn 时 teammate Session 尚不存在；只有 Lead Session 携带已记录策略，子 Session 继承它（[用户授权的子代理模型路由](2026-08-24-user-authorized-subagent-model-routes.zh.md)）。策略读取只有一个 home：`dsh-tool-subagent` 将其重新导出给 Team 执行器，而不是新建 agent-team 专用模型列表来源。

Team 状态不持久化第二份路由副本。subagent descriptor 拥有冷恢复所需的持久 `agentProvider`/`agentModel`/`agentReasoningEffort` 值，`TeamMemberSnapshot` 不携带模型副本，`TeamMemberView.model` 保持从 live agent 读取。

Lead/CEO 模型覆盖刻意不加到 Team `Config`。Lead 是普通根 Session，其模型已由 session 模型选择器与默认模型 picker 决定（[Web session 模型选择器](2026-07-24-web-session-model-selector.zh.md)、[默认模型跟随 picker](2026-08-07-default-model-follows-the-picker.zh.md)），且 Team 插件看到 Lead 时其 Agent 已创建，因此 Team `Config` 字段没有合法路径去改一个已存在 Agent 的选项。

## 备选方案

- **在 `TeamMemberSnapshot` 里持久化模型。** 拒绝：它制造第二个 home，并与已拥有冷恢复持久路由的 subagent descriptor 漂移。
- **新建 agent-team 专用模型列表。** 拒绝：`subagent/model-selection-policy` 加 `assertAllowedModelSelection` 已拥有授权，新来源会重复并在路由变化时发散。
- **让每位成员共享 Lead 模型。** 拒绝：需求是按 worker 选择，而 seam 已支持且无需新机制。
- **给 Team `Config` 加 `leaderAgentOptions`。** 拒绝：Lead 是普通根 Session，其模型在 Team 插件组合前已由 session 模型选择器与默认模型 picker 设定，Team `Config` 字段没有合法路径改它。
- **允许在 `fork` 上下文覆盖路由。** 拒绝：它放弃继承前缀的 provider 侧 KV-cache 复用；shipped fork 工具出于同样原因保持路由选择关闭。

## 后果

agent-team spawn 将每成员 `agentOptions` 送入既有 subagent start 路径，因此具有不同 provider、model 或 reasoning effort 的 teammate 可经 subagent descriptor 冷恢复，不需要 Team 自有持久化。未授权的 provider/model 选择在 Team spawn 阶段按直接 subagent 委派相同的策略来源失败，`context: 'fork'` 在静默丢失 KV-cache 前缀复用前失败。

复用 `assertAllowedModelSelection` 使 Team 工具插件耦合到 `dsh-tool-subagent`，但保留了模型选择授权的单一实现。Team 视图继续从 live subagent 状态派生模型信息，所以 snapshot 更小，也不会与持久 descriptor 漂移。
