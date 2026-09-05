# Agent Note: Archify summary path autofill and preview loop

Status: implemented

English | [中文](2026-09-04-agent-team-archify-autofill-preview.zh.md)

## Problem

Manual paste of `ARCHIFY_HTML_PATH` plus a second click to load preview breaks the dock closed loop, and Archify `visual-check` Chrome failures read as delivery failure.

## Decision

Keep Archify as an explicit CTA (no silent generate). Treat HTML on disk + `ARCHIFY_HTML_PATH` as delivery success; instruct the model that desktop-sandbox Chrome/visual-check skip or fail must not be narrated as delivery failure. Scan the lead Chat snapshot for a complete `.html`/`.htm` marker, autofill the Summary path field, and auto-load (with short retries while generating) into the sandboxed iframe.

## Alternatives considered

- **Host RPC to scan the session log.** Deferred: the Chat snapshot is already in the Client Conversation binding.
- **Patch upstream Archify Chrome flags.** Out of scope for this product loop; prompt guidance covers the failure narrative.

## Verification

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/discover-archify-path.spec.ts packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx
```
