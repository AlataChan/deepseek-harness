# Agent Note: Workbench panels sit on the client design system

Status: implemented

English | [中文](2026-09-17-workbench-panels-on-design-system.zh.md)

## Problem

The octopus_DSH workbench panels (knowledge-library picker and ask-data gate) referenced `--dsw-alias-*` names that `ui-theme` never declares. CSS fallbacks therefore painted the only color that reached the screen — `#c00`, `#b42318`, `#4d8dff`, or nothing at all — so dark mode was wrong and the picker card had no background. The picker also declared `role="dialog"` while rendering inline in the composer stack, with no `Escape` handling and no loading or empty state, and both surfaces opened with a wall of explanatory paragraphs.

## Decision

Workbench CSS uses only tokens declared in `packages/client/ui-theme/src/styles/`. Color, elevation, type, skeleton, and danger-hover aliases replace the phantom names and the literal fallbacks. `scripts/verify-client-css-tokens.ts` rejects any new `var(--dsw-…)` reference that the theme does not declare. Pre-existing undeclared uses outside the repaired sheets stay on a ratchet allowlist: each `file::token` pair must still exist, and removing a phantom requires deleting its row.

The knowledge picker is the existing `ui-primitives` `Modal` (`aria-modal`, mask, `Escape`, `--dsw-alias-bg-layer-2`, `--dsw-elevation-prominent`). One summary line plus a rules disclosure replace the five always-visible lead paragraphs. `listLibraries` has a loading skeleton and an empty catalog sentence. Batch rows keep their status text and add a glyph so failure is not color alone. The ask-data gate keeps its full-page layout, uses the same token and focus rules, and folds `pageLead` plus the pitfalls list behind `rulesToggle`.

Focus trap and focus return stay out of this change. They belong on `Modal` once, not on the picker.

Unified data-source identity (letter avatars, type badges, optional document counts) is [a later decision](2026-09-17-workbench-data-source-identity.md).

The dismiss and heal behavior in [the picker-dismiss note](../bug-fix/2026-09-16-desktop-knowledge-picker-dismiss-and-reject-heal.md) remains: the hero chip toggles, and the plus-menu bridge stays an idempotent open.

## Alternatives considered

**Keep the picker inline and only swap tokens.** Rejected: the dialog role on an inline region is an accessibility defect, and adding `aria-modal` there would trap focus in the composer. `Modal` already owns the overlay chrome the token swap would have rewritten by hand.

**Fail CI on every undeclared `--dsw-*` in the tree.** Rejected for this change: seventeen pre-existing pairs live in official client sheets and other overlays. A ratchet allowlist lands the gate without expanding this work into those packages.

**Invent the missing tokens in `ui-theme` under the guessed names.** Rejected: `--dsw-alias-bg-elevated` and `--dsw-alias-label-danger` have no theme meaning. Mapping onto `bg-layer-2` and `state-error-primary` keeps one vocabulary.

## Consequences

- A new workbench `var(--dsw-…)` that is not in `ui-theme` fails `verify-client-css-tokens` in hygiene and static CI.
- Library-picker tests query `document.body` because `Modal` portals there.
- `@deepseek-ai/dsh-client-ui-primitives` is a peer of `desktop-ask-knowledge`, matching `desktop-ask-data`.
- First-screen picker and ask-data copy is one summary; the longer rules remain in the dictionaries behind a disclosure.
