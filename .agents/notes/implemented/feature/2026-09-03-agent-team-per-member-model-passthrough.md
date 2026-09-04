# Agent Note: Agent Team per-member provider and model passthrough

Status: implemented

English | [中文](2026-09-03-agent-team-per-member-model-passthrough.zh.md)

## Problem

Agent Teams accepts a teammate `provider` (the subagent backend) but not per-teammate `provider`/`model`/`reasoningEffort`. The agent-team spawn passes only `{ prompt, parent }` to `startContinuable` (`roster.ts:281`), so a teammate always inherits the Lead's Agent options. The subagent seam already supports child `AgentOptions`: `SubagentCapabilities.agentOptions` gates it (`subagent/src/types.ts:127`), `resolveChildAgentOptions` writes the resolved route into the continuable `subagent/descriptor` as `agentProvider`/`agentModel`/`agentReasoningEffort` (`continuation.ts:421-434`, `descriptor.ts:72-86`), and cold resume rebuilds Agent options from that descriptor (`continuation.ts:989-995`). The gap is entirely on the Team side: it never threads `agentOptions` through.

## Decision

`SpawnTeammateRequest` carries `agentOptions?: AgentOptions`, and the agent-team roster threads it into `startContinuable({ request: { prompt, parent, agentOptions } })`. The `spawn_teammate` tool exposes optional `provider`, `model`, and `reasoning_effort` parameters that become those `agentOptions`.

The Team runtime rejects `agentOptions` when `context: 'fork'` with `TeamError(..., 'TEAM_FORK_NO_ROUTE_OVERRIDE')`. `context: 'fork'` seeds the child with the Lead's completed-turn prefix, and changing provider or model forfeits provider-side KV-cache reuse ([model-selected subagent routes](2026-08-18-model-selected-subagent-routes.md)). The shipped fork tool keeps route selection off for the same reason.

The Team spawn executor enforces the user-authorized allowlist against the calling Lead Session's recorded `subagent/model-selection-policy` by reusing `assertAllowedModelSelection` from `dsh-tool-subagent`. A teammate Session does not yet exist at spawn time; only the Lead Session carries the recorded policy, and a child inherits it ([user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md)). The policy read has one home: `dsh-tool-subagent` re-exports it for the Team executor rather than creating an agent-team-specific allowed-model source.

Team state does not persist a second route copy. The subagent descriptor owns the durable `agentProvider`/`agentModel`/`agentReasoningEffort` values for cold resume, `TeamMemberSnapshot` carries no model copy, and `TeamMemberView.model` remains a live read from the agent.

The Lead/CEO model override is deliberately not added to the Team `Config`. The Lead is an ordinary root Session whose model is already decided by the session model selector and the default-model picker ([web session model selector](2026-07-24-web-session-model-selector.md), [default model follows the picker](2026-08-07-default-model-follows-the-picker.md)), and the Team plugin sees the Lead only after its Agent is already created, so a Team `Config` field has no legal path to change an existing Agent's options.

## Alternatives considered

- **Persist the model in `TeamMemberSnapshot`.** Rejected: it creates a second home and drifts from the subagent descriptor that already owns the durable route for cold resume.
- **Build an agent-team-specific allowed-model list.** Rejected: `subagent/model-selection-policy` plus `assertAllowedModelSelection` already own authorization; a new source would duplicate it and diverge on route changes.
- **Share the Lead model for every teammate.** Rejected: the requirement is per-worker selection, and the seam already supports it with no new machinery.
- **Add `leaderAgentOptions` to the Team `Config`.** Rejected: the Lead is an ordinary root Session whose model is already set by the session model selector and default-model picker before the Team plugin composes, so a Team `Config` field has no legal path to change it.
- **Allow route overrides on the `fork` context.** Rejected: it forfeits provider-side KV-cache reuse of the inherited prefix; the shipped fork tool keeps route selection off for the same reason.

## Consequences

Agent-team spawn passes per-member `agentOptions` into the existing subagent start path, so a teammate with a distinct provider, model, or reasoning effort resumes through the subagent descriptor without Team-owned persistence. Unauthorized provider/model selections fail at Team spawn under the same policy source as direct subagent delegation, and `context: 'fork'` fails before it can silently lose KV-cache prefix reuse.

Reusing `assertAllowedModelSelection` couples the Team tool plugin to `dsh-tool-subagent`, but it keeps model-selection authorization in one implementation. Team views continue to derive model information from live subagent state, so snapshots stay smaller and cannot drift from the durable descriptor.
