# Agent Note: Agent Team 右侧协作舱

Status: implemented

[English](2026-09-04-agent-team-collaboration-dock.md) | 中文

## 问题

方案 C 顶栏徽章不足以看清协作；永久第三栏会挤占聊天。

## 决策

用 Client 右侧浮层舱呈现实时拓扑（默认约 40vw，可拖 280px–55vw，可钉住，Esc 关闭）。继续用同一份 `TeamView` / `interactions`。成员/任务/启动话术迁入舱底可折叠区。

## 备选

- **改 `ui-conversation` 真分栏。** 延后：布局契约成本高。
- **只保留下拉弹层。** 否决：图太小。

## 验证

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/
```
