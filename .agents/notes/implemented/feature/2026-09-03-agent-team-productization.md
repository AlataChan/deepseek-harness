# Agent Note: Agent Team productization — promotion, org view, and permission model

Status: implemented

English | [中文](2026-09-03-agent-team-productization.zh.md)

## Problem

Agent Teams incubates as private packages under `packages/experimental/` ([incubate Agent Teams as private experimental packages](../architecture/2026-08-18-experimental-agent-teams-packages.md)). Promotion has explicit gates. A workable management surface already exists — `TeamRoster.list()`, the generated `agentTeams/view` Remote, and the Web controls that navigate a teammate conversation over the stable subagent address ([Experimental Agent Teams Web controls](2026-08-06-agent-teams-web.md)) — but the roster row carried only identity, status, model, and diagnostics. It did not display the worker's durable output, and the worker-permission surface lacked a human review point for worker output the Lead intends to execute.

## Decision

Promotion is a gate, not a step. When the Team packages are promoted, move them to product-role groups, drop the `experimental-` npm prefix, update every import and composition row atomically, and satisfy the listed review: public contract, limitations, test evidence, release payload, runtime dependents, and a named owner accepting stable-package obligations (the [incubate decision](../architecture/2026-08-18-experimental-agent-teams-packages.md) owns the rules). No product-role package may depend on an experimental package.

The management gap is closed by extending `TeamMemberView` with an optional `result?: TeamMemberResult` field. `TeamMemberResult` carries an `outcome` ('completed' | 'failed') and an optional bounded `summary` derived from the worker session's last assistant text (truncated to 500 characters). The result is derived, not persisted: the worker session owns the durable history, and `result` is a read-only view assembled in `roster.list()` and `roster.memberView()`. Roster-row → conversation navigation continues to use the existing `{ parentSessionId, childSessionId, mode: 'continuable' }` stable subagent address; the [Web controls note](2026-08-06-agent-teams-web.md) remains the navigation owner without adding a Team-specific contract to the stable API Proxy. The Web UI displays the outcome as a badge and the summary as a truncated tooltip.

The human review point for worker output the Lead intends to execute is a new `propose_action` tool (Lead-only) in `tool-agent-team`. It accepts `action_kind` ('patch' | 'command' | 'followup'), a `description`, and `content`, builds a `ProposedAction`, and routes it through the Lead's existing `ctx.userQuestions.ask()` seam with `intent: { kind: 'plan-review', approve: 'Execute' }`. The [approval seam](2026-08-10-subagent-approval-pinned-never.md) pins children to `'never'`, so the review lives on the Lead side (a root Session that can call `ctx.userQuestions.ask()`), not the worker's. The tool returns `{ approved, action }`; an approved action lets the Lead proceed with the proposed patch, command, or follow-up task.

The worker-permission surface is not rebuilt: approval pinning ([subagent approval pinned never](2026-08-10-subagent-approval-pinned-never.md)), product subagent non-interactive permissions ([product subagent noninteractive permissions](2026-08-15-product-subagent-noninteractive-permissions.md)), subagent policy inheritance ([subagent policy inheritance](2026-07-25-subagent-policy-inheritance.md)), and `toolFilter` passed through `startContinuable` already compose the worker boundary. Team creation stays user-requested, per the explicit delegation policy in the [agent-teams decision](2026-08-05-agent-teams.md).

The human interacts with the Lead; workers are not directly human-facing. The promotion checklist is recorded in the `agent-team` README Dev Note.

Out of scope: cross-team messaging, a global agent directory, arbitrary session-to-session pipes, and an open subscription model. They add unbounded authorization and state-coherence problems for no user value; open them only on a concrete need.

## Alternatives considered

- **Promote packages without an explicit permission model.** Rejected: unbound worker tools and auto-executed delegate output is the unsafe default.
- **Give the human direct worker-facing control.** Rejected: it inverts the Lead/human boundary and multiplies approval load; the Lead is the manager.
- **Extend the stable API Proxy with Team contracts before promotion.** Rejected: it couples a stable wire package to an experimental domain, which the [Web controls note](2026-08-06-agent-teams-web.md) already rejected.
- **Rebuild the worker-permission surface from scratch.** Rejected: approval pinning, non-interactive permission policy, policy inheritance, and `toolFilter` already compose the worker boundary; the only gap was the human review point on Lead-intended worker output.
- **Persist the worker result in `TeamMemberSnapshot`.** Rejected: the worker session already owns the durable history; persisting a second copy would create a second home and drift from the authoritative source.

## Consequences

- `TeamMemberView.result` is a derived read-only view; it carries no durable state and is rebuilt on every `list()` / `memberView()` call. An inactive teammate with no loaded session produces no result until the session is loaded or cold-read.
- The `propose_action` tool blocks the Lead until the human answers; a long review holds the Lead's turn. The tool does not pass `exec.signal` to `ask()` — the question lives until answered.
- The promotion checklist in the `agent-team` README Dev Note is a living document; it records the eight gates a maintainer must satisfy before moving the experimental packages to product-role groups.
- The Web Team UI remains experimental and may expose both the Team roster and legacy child controls; a Team-aware Web preset is deferred (the [Web profile README](../../../../packages/experimental/agent-team-web-profile/README.md#known-limitations-and-deferred-work) owns the current limitation).
