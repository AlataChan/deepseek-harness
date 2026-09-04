# Agent Note: 未运行的 Team 名单不得伪造 Lead 模型

Status: implemented

[English](2026-09-04-agent-team-inactive-roster-model.md) | 中文

## Problem

`TeamRoster.list` 把未运行队友的 `model` 解析成 `live?.options.model ?? root.options.model`。子 Activation drain 后，UI 与之后的 `list_agents` 会显示 Lead 模型，即使 `spawn_teammate` 已为子路由选了别的模型。Lead 在子仍存活时的工具回复（或 spawn 结果）与 Team 面板不一致。

## Decision

按此顺序解析队友模型：live Agent options、持久化 `TeamMemberSnapshot.model`、continuable descriptor 的 `agentModel`、子会话 request context/header。在 spawn 结算为 active 时把 `model` 写入 `team/member` snapshot。仅当 `context: 'fork'` 且未声明自身路由时，才回退到 Lead 模型。

## Alternatives considered

- **保留 Lead 回退，让用户忽略面板。** 否决：面板是用户侧与 `list_agents` 并列的名单权威。
- **仅为该字段抬升 `team/member` 事件版本。** 否决：在 version 2 上增加可选 `model` 足够；没有 `model` 的旧 snapshot 仍可在有 descriptor/session 时恢复。

## Consequences

- 未运行名单在 drain 后、以及 Host 重启后（active snapshot 已记录 `model` 时）仍保留子路由。
- 未显式声明路由的 fork 队友仍显示 Lead 模型。
- 从未写入 `model`、且子 Session 已不在内存的旧 Team，可能暂时省略 `model`，直到下次 spawn 或 resume 刷新 snapshot。
