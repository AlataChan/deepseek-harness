# Agent Note: Archify 总结图路径回填与预览闭环

Status: implemented

[English](2026-09-04-agent-team-archify-autofill-preview.md) | 中文

## Problem

用户还要手贴 `ARCHIFY_HTML_PATH` 再点加载，闭环不完整；Archify `visual-check` 在桌面沙箱失败时会被写成交付失败。

## Decision

仍用显式 CTA（不静默生成）。交付成功 = HTML 落盘 + `ARCHIFY_HTML_PATH`；提示模型桌面沙箱下 Chrome/visual-check 跳过或失败不得写成交付失败。从 Lead 的 Chat 快照扫描完整 `.html`/`.htm` 标记，自动回填总结图路径并自动加载（生成中短重试）到沙箱 iframe。

## Alternatives considered

- **Host RPC 扫会话日志。** 延后：Client Conversation 已有 Chat 快照。
- **改上游 Archify Chrome 参数。** 本次不做；话术覆盖失败叙事。

## Verification

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/discover-archify-path.spec.ts packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx
```
