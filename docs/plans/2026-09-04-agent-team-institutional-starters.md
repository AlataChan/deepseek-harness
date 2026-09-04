# Agent Team 机构启动话术 + 分层可视化 Implementation Plan

> **For Claude:** Execute task-by-task; this landing ships Phase 1 fully.

**Goal:** Replace generic researcher/squad/list starters with institutional NGO squad prompts (English kebab `name` + Chinese duties), and lock the agreed UI/Archify layering for follow-ups.

**Architecture:** Starter copy lives only in `client-ui-agent-team` locales. Teammate machine ids stay `lower-kebab-case`; Chinese appears in labels and prompt bodies. Live topology and Archify are separate layers (same TeamView facts vs post-hoc HTML)—not in this code change.

**Tech stack:** `@deepseek-ai/dsh-experimental-client-ui-agent-team` React Client UI, locale dictionaries, vitest client specs, Agent Note pair.

---

## Scope of this landing (Phase 1 — 100%)

1. Replace the three fill buttons with: 组文书项目组 / 组案例档案组 / 组传播协作组.
2. Prompt bodies require English `name=` ids and Chinese role text; Lead does not write final drafts; no invented numbers; human review before external send.
3. Update `TeamAction` template key switches + client tests + Agent Note.

## Explicitly out of this landing (follow-ups)

| Layer | Status |
|---|---|
| 对话 / Team 面板 CAS | Already shipped |
| 实时图（瘦状态、同 TeamView、可关） | **Shipped** in `2026-09-04-agent-team-live-topology` — panel refresh path, no polling |
| Archify 事后总结 | Opt-in: `dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0` — **not** default DMG seed |

True Client push for topology (without manual/mutation refresh) remains a later slice when session projection streaming is wired to this panel.

---

## Task 1: Locales

Files: `packages/experimental/client-ui-agent-team/src/client/locales.ts`

- `STARTER_TEMPLATES = ['document', 'case', 'comms']`
- zh/en labels + bodies (see Decision in Agent Note)
- Remove researcher/squad/list keys

## Task 2: TeamAction switches

File: `packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx`

- `templateLabelKey` / `templateBodyKey` switch on new ids with `assertNever`-style exhaustiveness via switch

## Task 3: Tests

File: `packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx`

- Click 组文书项目组 / document label; expect document body in `setDraft`

## Task 4: Agent Note

`.agents/notes/implemented/feature/2026-09-04-agent-team-institutional-starters.{md,zh.md,i18n.yaml}`

## Task 5: Verify

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx
```

## Archify smoke (manual, not coded here)

```bash
dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0
```

Then after one Team run: ask Lead to load archify skill and map the squad pipeline to HTML; open returned path.
