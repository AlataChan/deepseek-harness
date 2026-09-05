# Agent Note: Agent Team Archify dock summary preview

Status: implemented

English | [中文](2026-09-04-agent-team-archify-summary-preview.zh.md)

## Problem

After Archify writes HTML, users need to see it without leaving the collaboration surface, without silent auto-run.

## Decision

Keep Archify as a user-confirmed post-hoc step (dock CTA fills and sends the prompt). Add a Team dock Summary tab that loads HTML through `agentTeams.readHtmlPreview` into a sandboxed `blob:` iframe; on failure, fall back to `session.openWorkspacePath`. Desktop CSP allows `frame-src` / `child-src` `blob:`.

## Alternatives considered

- **Auto-run Archify on task settle.** Rejected: token cost and surprise.
- **Browser-only open, no iframe.** Deferred as fallback only; primary ask was in-dock preview.

## Verification

```bash
pnpm exec vitest run packages/experimental/agent-team/tests/read-html-preview.spec.ts packages/experimental/client-ui-agent-team/tests/
```
