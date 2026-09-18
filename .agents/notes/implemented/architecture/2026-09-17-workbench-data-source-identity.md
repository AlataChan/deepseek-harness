# Agent Note: Workbench data-source identity uses letter avatars, type badges, and optional document counts

Status: implemented

English | [中文](2026-09-17-workbench-data-source-identity.zh.md)

## Problem

The knowledge picker, settings roster, hero chips, and ask-data list showed plain names. Batch rows used text glyphs. The Upgrade 3 mock in [the design audit](../../../../docs/plans/2026-09-17-workbench-frontend-design-audit.md) looks like a dashboard, not the conversation shell, so a new home page would have replaced the three existing entries instead of identifying them.

## Decision

Identity lives on the conversation chips, the knowledge picker, the ask-data list, and the settings roster. Each row shows a letter avatar (first grapheme of the display name; hue 0–2 from `--dsw-alias-state-business/success/warn` primary and tertiary), the name, and a type badge: 文档库, 示例, 表格, or 已保存. Knowledge rows may also show the ingested `raw/*.md` count as `{count} 篇`.

`AskKnowledgeLibrary.documentCount` and `SessionAskKnowledgeLibrary.documentCount` are optional. The experimental catalog fills them by counting `raw/*.md` (0 when the vault is missing or `raw/` is absent). The field rides the existing list remotes; typert is not regenerated. Batch status keeps its locale text and uses `IconQueueOutline14`, `IconLoadingOutline16`, `IconCheckOutline16`, and `IconCloseOutline16`. Hang and chip buttons set `aria-label` to the display name so accessible names stay the name.

The three entries stay (hero chip, plus menu, settings). Official plus-menu copy is unchanged. Icons come from `ui-primitives`; a second icon library and growth of the official set are out of scope. The dashboard mock is not a home page.

## Testing

Focused jsdom specs cover the picker badge and `{count} 篇`, settings 文档库, ask-data 示例 / 表格 / 已保存, chip `aria-label`s, and catalog counts 0 then 1 after writing `raw/*.md`. `verify-client-css-tokens` covers the new avatar hues. `verify-client-ui-i18n` covers the new keys. Coverage includes `SourceIdentity`, `library-initial`, `source-initial`, and catalog `documentCount`.

## Alternatives considered

**Build the dashboard mock as a new home page.** Rejected: identity belongs on the chips, picker, list, and settings that already exist. A new dashboard would replace the conversation shell.

**Collapse the three entries to two.** Rejected: the settings roster is management, the picker hangs a library on a session, and the plus menu is the official attach path. Unifying posture does not require deleting an entry.

**Persist `documentCount` in `catalog.json`.** Rejected: the count is derived from the vault. Storing it would drift from `raw/` and enlarge the on-disk catalog schema.

**Grow the official icon set or add a second library.** Rejected: the desktop bundle is size-sensitive, and queue, loading, check, close, folder, and data icons already exist in `ui-primitives`.

## Consequences

- List remotes may carry `documentCount` without a typert regen.
- Catalog list now reads `raw/`.
- Hang and chip tests query the display name as the accessible name.
- Avatar hues are declared theme tokens; new phantom `var(--dsw-…)` names still fail `verify-client-css-tokens`.
