# Agent Note: Agent Team 协作舱软刷新与持久消息边

Status: implemented

[English](2026-09-04-agent-team-dock-live-refresh.md) | 中文

## 问题

手动刷新让舱像死的；消息边在投递后立刻消失。

## 决策

舱打开时约每 1.5 秒静默软刷新 `TeamView`，关闭即停。消息边同时覆盖待投递与已投递 mailbox 跳转（仍不含正文）。

## 备选

- **会话事件推送、不要 interval。** 延后到该面板接上投影流。
- **继续只画待投递边。** 否决：用户常只看到节点。

## 验证

```bash
pnpm exec vitest run packages/experimental/agent-team/tests/interactions.spec.ts packages/experimental/client-ui-agent-team/tests/
```
