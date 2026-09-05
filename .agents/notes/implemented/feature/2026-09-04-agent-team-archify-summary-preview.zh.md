# Agent Note: Agent Team Archify 舱内总结图预览

Status: implemented

[English](2026-09-04-agent-team-archify-summary-preview.md) | 中文

## 问题

Archify 写出 HTML 后，用户需要在协作界面内看到结果，且不要静默自动跑。

## 决策

Archify 仍为用户确认的事后步骤（舱内 CTA 填入并发送）。协作舱「总结图」页经 `agentTeams.readHtmlPreview` 读 HTML，沙箱 `blob:` iframe 预览；失败则 `session.openWorkspacePath`。桌面 CSP 允许 `blob:` frame。

## 备选

- **任务完成自动跑 Archify。** 否决：费用与打扰。
- **只浏览器打开。** 仅作失败回退；主诉求是舱内预览。

## 验证

```bash
pnpm exec vitest run packages/experimental/agent-team/tests/read-html-preview.spec.ts packages/experimental/client-ui-agent-team/tests/
```
