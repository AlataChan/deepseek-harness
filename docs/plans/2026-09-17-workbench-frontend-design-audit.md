# Workbench Frontend Design Audit

English | [中文](2026-09-17-workbench-frontend-design-audit.zh.md)

Date: 2026-09-17

Scope: the octopus_DSH workbench frontend — the conversation shell plus the three workbench surfaces (knowledge-library picker, ask-data gate, commerce), evaluated at the design-system level.

Method: source-level audit of the design tokens, component structure, interaction states, accessibility attributes, copy density, and motion policy, followed by verification of every token name against `packages/client/ui-theme/src/styles/`. No visual capture was available; every finding cites the file that produces the rendered result.

## Executive summary

The underlying design system is healthy: colors are token-driven with a real dark theme, elevation and type are tokenized, the chat surface has focus states and reduced-motion handling, and all user-facing copy is locale-owned and gate-enforced. The workbench panels sit outside that system, and the mechanism is more specific than "hand-written pixel values": **both workbench packages reference design tokens that do not exist.** `LibraryPicker.module.css` and `DataSourcePage.module.css` name seven `--dsw-alias-*` variables that `ui-theme` never defines, so the CSS fallbacks — or nothing at all — are what actually renders in both themes. On top of that, the picker declares `role="dialog"` while rendering as an inline region, has no focus, loading, or empty states, and presents five paragraphs of prose where a one-line summary belongs. The fix is narrower than a redesign: repair the token names, decide inline-region versus `Modal` once, then reduce copy and add states.

## What is already good

- **Token-driven color with a real dark theme.** `body[data-ds-dark-theme]` swaps the alias token set (`packages/client/ui-theme/src/styles/design-platform.css`).
- **Tokenized elevation and type.** `--dsw-elevation-prominent` / `-panel` / `-soft` / `-stroke` and `--dsw-font-*` (for example `--dsw-font-xxs-12`, `--dsw-font-s-strong-14`) live in `gradient-shadow-text.css`; every chat popover (`Modal`, `Menu`, `MenuView`, `PopupSelectView`, `ModelSelect`, `ContextMeter`, `TurnUsagePanel`) uses `--dsw-elevation-prominent`.
- **A computed content type scale.** `--dsh-content-font-size` plus derived deltas drive the markdown heading/body scale.
- **Focus and motion discipline in the chat surface.** `:focus-visible` rules are present across client packages and `ui-chat` guards its transitions with `prefers-reduced-motion`.
- **Locale-owned copy.** Every string routes through typed dictionaries behind `verify-client-ui-i18n`, so nothing is hard-coded in components.
- **A reusable dialog primitive.** `ui-primitives/Modal` provides a body-portaled card with mask, `Escape`, `aria-modal`, `--dsw-alias-bg-layer-2`, and `--dsw-elevation-prominent`.

## Finding 1 — rendering defects

These are bugs, not polish. Each undefined variable makes its declaration fall back to the literal after the comma, or — when there is no literal — become invalid at computed-value time and reset to the property's initial value.

| Phantom token | Where | What actually renders | Correct token |
|---|---|---|---|
| `--dsw-alias-bg-elevated`, `--dsw-alias-bg-primary` | `LibraryPicker.module.css` `.panel` | Both undefined, no literal fallback: **the panel has no background in either theme.** It looks correct only because the composer stack behind it is opaque. | `--dsw-alias-bg-layer-2` |
| `box-shadow: 0 8px 24px rgb(0 0 0 / 12%)` | `LibraryPicker.module.css` `.panel` | A light-theme shadow in dark mode. | `--dsw-elevation-prominent` |
| `--dsw-alias-label-danger` | `LibraryPicker.module.css` `.remove`, `.batchFailed`, `.error` | Always `#c00`; the token side never fires. | `--dsw-alias-state-error-primary` |
| `--dsw-alias-text-danger` | `DataSourcePage.module.css` `.missing`, `.error` | Always `#b42318`, a light-only red. | `--dsw-alias-state-error-primary` |
| `--dsw-alias-border-primary` | `DataSourcePage.module.css` `.rowPick:hover` | Always `#3d3d3d`, a dark-only border. | `--dsw-alias-border-l2` |
| `--dsw-alias-border-brand` | `DataSourcePage.module.css` `.rowSelected .rowPick` | Always `#4d8dff`. | `--dsw-alias-state-business-primary` |
| `--dsw-alias-fill-brand-soft` | `DataSourcePage.module.css` `.rowSelected .rowPick` | Always `rgb(77 141 255 / 12%)`. | `--dsw-alias-state-business-tertiary` |
| `--dsw-alias-bg-elevated` | `DataSourcePage.module.css` `.templateBody` | Always `transparent`. | `--dsw-alias-bg-layer-2` |

Two packages independently invented seven names. No gate checks `var(--dsw-…)` references against `ui-theme` (`scripts/` contains no such verifier), so the pattern will recur until one exists.

## Finding 2 — improvement opportunities

| # | Opportunity | Evidence |
|---|---|---|
| 1 | Give the workbench panels focus styles. The chat surface has `:focus-visible` rules throughout; the knowledge and ask-data panels have none, so keyboard users cannot see focus. | `LibraryPicker.module.css` has no `:focus` rule; `DataSourcePage.module.css` has none; only commerce has one. |
| 2 | Add loading and empty states. `listLibraries` is asynchronous and the panel renders an empty list until it resolves; when the catalog is genuinely empty, only the create button appears with no explanation. | `LibraryPicker.tsx` tracks `rows`/`error` only; there is no loading flag and no `rows.length === 0` branch. |
| 3 | Cut copy density. The picker opens with five consecutive explanatory paragraphs above the action area. | `locales.ts` defines five `picker.lead*` keys, all rendered as `<p className={css.lead}>` in `LibraryPicker.tsx`. |
| 4 | Adopt the type tokens. Panels set `font-size: 12px; line-height: 18px` and `font-size: 14px; font-weight: 600` by hand where `--dsw-font-xxs-12` and `--dsw-font-s-strong-14` exist. Spacing and radius have no tokens anywhere in `ui-theme`, and chat chrome (`InputBar.module.css`) also uses px literals for them, so spacing is not a divergence to fix here. | `LibraryPicker.module.css` `.lead`, `.title`, `.batch`. |
| 5 | Add a motion policy. Panels mount and unmount instantly while chat popovers transition. | No `transition` or `prefers-reduced-motion` in the ask-knowledge or ask-data CSS. |
| 6 | Stop signaling batch status by color alone. A failed row is red text with no icon or shape, which fails WCAG 1.4.1 for color-blind users. | The batch `<li>` in `LibraryPicker.tsx` only swaps a red class. |
| 7 | Use the danger hover token. `.remove:hover` uses the neutral hover background. | `--dsw-alias-interactive-bg-hover-danger` exists and `Menu.module.css` uses it for destructive items. |

## Finding 3 — design defects

**A. A dialog role on an inline region.** `LibraryPicker` declares `role="dialog"` but `ConversationRoot.tsx` renders it inline in the composer stack, between the hero row and the input bar, with no portal, mask, or focus management. Adding `aria-modal` and a focus trap here would be an accessibility regression: the panel is not modal. The role must match the rendering, which forces the decision in the next section. Whichever way it goes, the current state — a dialog role, a close button for pointer users, no `Escape`, no focus move on open, no focus return on close — is a functional accessibility defect.

**B. Prose used as interface.** The picker explains what a knowledge library is, how it differs from ask-data, how data-mode behaves, and how to add documents as five continuous paragraphs above the controls. The user's task is "pick a library"; the interface answers with a wall of text. Hierarchy should come from structure (grouping, disclosure, tooltips), not paragraph count. The ask-data gate has the same defect at full-screen scale.

**C. Three entries, three semantics.** The same picker is reachable from the hero chip (`conversation.hero.askKnowledge`, a toggle), the composer "+" menu (`conversation.input.attachKnowledge`, opens the list), and the settings page (`settings.section`, a roster). Each entry behaves differently, so the mental model of "knowledge base" is unstable — button, menu item, or setting depending on where you start. This inconsistency contributed to the earlier "every upload creates a new library" confusion: entering from "+" does not communicate that you are creating.

**D. Two visual languages in one product.** The chat surface is a complete system (tokens, elevation, motion, focus). The workbench panels are hand-rolled floats with phantom tokens, no motion, and no focus. Side by side, the workbench reads as an afterthought rather than as the product.

## Decision required first: inline region or `Modal`

Every downstream upgrade depends on this choice, so it precedes them.

| | Keep inline | Adopt `ui-primitives/Modal` |
|---|---|---|
| Semantics | Replace `role="dialog"` with `<section aria-labelledby={titleId}>`; move focus to the heading on mount; return focus to the invoking chip or menu item on close; handle `Escape` locally. | `Modal` already supplies `role="dialog"`, `aria-modal`, mask click, and `Escape`. |
| Visual | Must repair background, elevation, and radius by hand (Finding 1). | Inherits `--dsw-alias-bg-layer-2`, `--dsw-elevation-prominent`, radius, header, and close button; the picker's own header markup and `.panel`/`.close` CSS are deleted. |
| Three entries (Defect C) | Still three different postures. | All three entries open the same modal, so the posture is unified without waiting for Upgrade 3. |
| Layout | Pushes the composer down while open. | Overlays; the composer stays put. |
| Gaps | — | `Modal` has no focus trap and no focus return. If either is wanted, add it to the primitive once, not to the picker. |

Recommendation: adopt `Modal`. It removes code from the picker, fixes most of Finding 1 for free, and resolves Defect C's posture inconsistency in the same change.

## Recommendations — three upgrades, in order

**Upgrade 1 · Repair the tokens and gate them.**

Apply the "Correct token" column of Finding 1 to both `LibraryPicker.module.css` and `DataSourcePage.module.css`; delete every literal fallback so a future phantom fails visibly instead of silently. Replace hand-set `font-size`/`line-height` pairs with `--dsw-font-xxs-12` and `--dsw-font-s-strong-14`. Add `--dsw-alias-interactive-bg-hover-danger` to `.remove:hover`. Add `:focus-visible` rules matching the chat surface. Add 120ms opacity/transform enter transitions behind `@media (prefers-reduced-motion: no-preference)`. In the same PR, add `scripts/verify-client-css-tokens.ts` that rejects any `var(--dsw-…)` reference under `packages/**/*.css` not declared in `ui-theme/src/styles/`, wire it into `run-gates.ts`, and prove it rejects the pre-fix files.

Payoff: the panels render correctly in both themes for the first time; the class of bug cannot recur. Cost: low — a find-and-replace once the mapping is written, plus one short verifier. Risk: low.

**Upgrade 2 · Progressive disclosure, tri-state, and correct dialog semantics.**

Collapse the five lead paragraphs into one summary line plus a collapsible rules disclosure. Add a loading skeleton using `--dsw-alias-bg-skeleton`, an explicit empty state with its own copy, and `aria-describedby` from the panel to `.error`. Give each batch row an icon or glyph beside its color so status survives color blindness. Implement the semantics chosen above — either the `<section>` region pattern or the `Modal` wrap — and, if `Modal`, delete the picker's own header, close control, and `.panel` CSS.

Payoff: first-screen text drops by roughly 80%, hierarchy clarifies, and the accessibility defect closes. Cost: medium (component plus copy). Risk: low.

**Upgrade 3 · A unified "data source" visual language.**

Converge ask-data and knowledge under one "data source" concept with type badges (table vs document library), library identity (initial avatar plus document count), and icon-plus-shape batch status; unify the three entries under one metaphor. Icons extend `ui-primitives/src/icons/index.tsx`; a second icon library is out of scope because the desktop bundle is size-sensitive.

Payoff: the workbench gains a visual identity and the three-entry confusion disappears. Cost: high (information architecture plus icon additions). Risk: medium.

Recommended order is 1 → 2 → 3. Upgrade 1 is a correctness fix and lands alone. Upgrade 2 depends on the inline/`Modal` decision. Upgrade 3 redefines the information architecture and follows once the first two land.

## Verification

Each upgrade changes assembled browser output, so each needs the checks below in its PR; snapshot evidence is required for user-visible changes.

| Upgrade | Commands |
|---|---|
| 1 | `pnpm run verify-client-css-tokens` (new; must fail on the pre-fix tree and pass after), `pnpm run test:gui`, `DSH_SNAPSHOT=replay pnpm run test:web`, plus a light/dark screenshot pair of the picker and ask-data gate. |
| 2 | `pnpm run test:gui` with new specs for loading, empty, and error states and for `Escape`/focus behavior; `DSH_SNAPSHOT=replay pnpm run test:web`; `pnpm run verify-client-ui-i18n` for the new copy keys. |
| 3 | The Upgrade 2 set plus `pnpm run verify-client-packages` if icon exports change. |

## Open questions

- Inline region or `Modal` — chosen: `Modal` (Upgrade 1–2 shipped on that choice).
- Whether the three entries should collapse to two — chosen: keep three (hero chip, plus menu, settings roster). Identity lands on those surfaces, not a new home page.
- Whether spacing and radius tokens should be introduced into `ui-theme` as a separate proposal. They do not exist today, chat chrome uses px literals for them too, and adding them is a design-system change, not a workbench fix.
