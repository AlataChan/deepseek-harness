# Agent Note: Agent Team 产品化 —— 晋升、org 视图与权限模型

Status: implemented

[English](2026-09-03-agent-team-productization.md) | 中文

## 问题

Agent Teams 以私有包在 `packages/experimental/` 下孵化（[将 Agent Teams 作为私有实验包孵化](../architecture/2026-08-18-experimental-agent-teams-packages.zh.md)）。晋升有明确门禁。可用的管理面已部分存在——`TeamRoster.list()`、生成的 `agentTeams/view` Remote、以及经稳定 subagent 地址导航 teammate 对话的 Web 控件（[实验性 Agent Teams Web 控件](2026-08-06-agent-teams-web.zh.md)）——但 roster 行只携带身份、状态、模型与诊断，不显示 worker 的最终产出；且 worker 权限面缺乏对 Lead 要执行的 worker 产出的人工审阅点。

## 决策

晋升是门禁，不是一步。当 Team 包晋升时，把它们移到产品角色分组，去掉 `experimental-` npm 前缀，原子更新所有 import 与组合行，并满足列出的评审：公共契约、限制、测试证据、发布载荷、运行时依赖、以及接受稳定包义务的指定所有者（[孵化决策](../architecture/2026-08-18-experimental-agent-teams-packages.zh.md) 拥有规则）。任何产品角色包都不得依赖实验包。

管理缺口通过扩展 `TeamMemberView` 增加可选 `result?: TeamMemberResult` 字段关闭。`TeamMemberResult` 携带 `outcome`（'completed' | 'failed'）与可选有界 `summary`（从 worker session 的最后 assistant 文本派生，截断到 500 字符）。result 是派生的、不持久化的：worker session 拥有持久历史，`result` 是在 `roster.list()` 与 `roster.memberView()` 中组装的只读视图。roster 行 → 对话导航继续使用现有的 `{ parentSessionId, childSessionId, mode: 'continuable' }` 稳定 subagent 地址；[Web 控件 note](2026-08-06-agent-teams-web.zh.md) 保持导航所有者身份，不向稳定 API Proxy 增加 Team 专属契约。Web UI 以 badge 显示 outcome，以截断 tooltip 显示 summary。

Lead 要执行的 worker 产出的人工审阅点是一个新的 `propose_action` 工具（Lead-only），位于 `tool-agent-team`。它接受 `action_kind`（'patch' | 'command' | 'followup'）、`description` 与 `content`，构建 `ProposedAction`，并经 Lead 现有的 `ctx.userQuestions.ask()` seam 路由，使用 `intent: { kind: 'plan-review', approve: 'Execute' }`。[审批 seam](2026-08-10-subagent-approval-pinned-never.zh.md) 把 children 钉为 `'never'`，因此审阅在 Lead 侧（root Session 可调用 `ctx.userQuestions.ask()`），不在 worker 侧。工具返回 `{ approved, action }`；批准后 Lead 可继续执行提议的 patch、命令或 follow-up 任务。

worker 权限面不重建：审批钉（[subagent 审批永不钉](2026-08-10-subagent-approval-pinned-never.zh.md)）、产品 subagent 非交互权限（[产品 subagent 非交互权限](2026-08-15-product-subagent-noninteractive-permissions.zh.md)）、subagent 策略继承（[subagent 策略继承](2026-07-25-subagent-policy-inheritance.zh.md)）、以及经 `startContinuable` 透传的 `toolFilter` 已组合出 worker 边界。Team 创建保持用户请求，符合 [agent-teams 决策](2026-08-05-agent-teams.zh.md) 的显式委派策略。

human 只与 Lead 打交道；worker 不直接对人。晋升清单记录在 `agent-team` README Dev Note 中。

不在范围内：跨团队消息、全局 agent 目录、任意 session 间自由管道、开放订阅模型。它们只为工程师买单、不带来用户价值，还为授权与状态相干引入无界问题；只在有具体需求时开口子。

## 备选方案

- **无显式权限模型就晋升。** 拒绝：不受限的 worker 工具与自动执行的委派输出是不安全默认。
- **把 worker 直接交给 human 控制。** 拒绝：它颠倒 Lead/human 边界并放大批准负担；Lead 才是经理。
- **晋升前把 Team 契约加进稳定 API Proxy。** 拒绝：它把稳定 wire 包耦合到实验域，[Web 控件 note](2026-08-06-agent-teams-web.zh.md) 已拒绝。
- **从零重建 worker 权限面。** 拒绝：审批钉、非交互权限策略、策略继承与 `toolFilter` 已组合出 worker 边界；唯一缺口是 Lead 要执行的 worker 产出的人工审阅点。
- **在 `TeamMemberSnapshot` 里持久化 worker result。** 拒绝：worker session 已拥有持久历史；持久化第二份会制造第二个 home 并从权威来源漂移。

## 后果

- `TeamMemberView.result` 是派生只读视图；不携带持久状态，每次 `list()` / `memberView()` 调用重建。inactive teammate 在 session 未加载时不产生 result，直到 session 被加载或冷读。
- `propose_action` 工具在 human 回答前阻塞 Lead；长时间审阅会占用 Lead 的 turn。工具不向 `ask()` 传 `exec.signal`——问题在回答前一直存活。
- `agent-team` README Dev Note 中的晋升清单是活文档；记录维护者把实验包移到产品角色组前必须满足的 8 项门禁。
- Team Web UI 仍是实验性，可能同时暴露 Team roster 与遗留子控件；Team-aware Web preset 被推迟（[Web profile README](../../../../packages/experimental/agent-team-web-profile/README.zh.md#known-limitations-and-deferred-work) 拥有当前限制）。
