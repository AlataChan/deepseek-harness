# Agent Note: Ask-data gate exits, imports stop twinning, and rule ids leave operator copy

Status: implemented

English | [中文](2026-09-16-desktop-ask-data-gate-exit-and-rule-copy.zh.md)

## Problem

The desktop 问数 gate reported the same two defects as the knowledge picker, plus a leak nobody had filed.

The gate could not always be left. It had no close control, and the chip never toggled: `registerGate` returned early when a gate existed and `openFromChip` staged the preset on every click, so a second click on 问数 did nothing. The one visible exit, 取消, ran `const refusal = await seat.select(previousPreset); if (refusal !== undefined) return`, so whenever the host refused the preset revert the button did nothing and said nothing.

The source list accumulated twins. Every import minted a fresh `src-<uuid>` row, so uploading `用户信息.csv` twice listed that filename twice under 最近使用; `replaceSourceId` existed but only the reselect control for a `missing` row ever set it.

All four operator-facing surfaces each had to contain all twelve internal rule ids — `limits-copy.ts` declared the closed set and its spec asserted every surface contained every id — so the page lead and the helper above the upload button printed `accept-xlsx-csv one-file-one-source first-row-header header-empty header-duplicate type-guess sheet-name file-size row-count decoded-cell csv-encoding no-merge-repair` verbatim, and the seven preview warnings and the sqlite3 hint appended their own ids the same way.

## Decision

The page carries a close control beside its title; the chip toggles the gate; and leaving never waits on a refused preset revert. The preset seat already reports its own refusal, and a gate nobody can close is worse than a session that stays staged as data-agent, so 取消 now always clears the stage and closes.

The import resolves its row by basename among `kind === 'import'` rows, so re-uploading one filename replaces that row in place and keeps its `connectionRef` and `lastUsedAt`; an explicit `replaceSourceId` still wins. One file stays one source and 最近使用 cannot list a twin.

Rule ids are model-facing only. `rule-copy.ts` maps each rule id (`RULE_EXPLANATIONS`, keyed by the closed id set), each preview warning id (`WARNING_KEYS`), and each seam failure code (`FAILURE_KEYS`) onto one locale key. `failureCopy` reads the seam code Session Controller carries in the failure details, because every ask-data failure reaches the browser as `session/ask-data-failed` with the business code in `details`; an unknown code falls back to the wire message, and an unknown preview warning to its own id. `limits-copy.ts` and its spec are deleted, replaced by a spec asserting that every rule id has copy and that no operator-facing string contains one.

`AskDataErrorCode` moved from the host `index.ts` to the shared `types.ts` outlet, which `./client` re-exports. Client aggregates must name that code to pick copy, and the first cut's bare `@deepseek-ai/dsh-host-ask-data` import dragged the Host `AskData` service and the `dsh-session` root into the browser program, which retyped the `sessions` service under `scope.sessions` and broke the whole client face.

## Alternatives considered

**Keep the early return and show the refusal inside the gate.** Rejected: that preserves the trap for exactly the case the report names. Leaving is the user's intent, and the refusal already has a surface on the preset seat.

**Toggle only the chip, no close control.** Rejected: the gate is a composer takeover that hides the input bar, so a visible dismiss control is the only affordance a user finds without knowing the chip is a toggle.

**Dedupe by sqlite content instead of filename.** Rejected: one file can be renamed and two files can share a name, while the filename is what the list shows and what the user means. The explicit reselect path already covers replacing a row whose file vanished.

**Refuse a same-name upload with a message.** Rejected: it fails the same user gesture on the second try, and the existing row carries identity (`connectionRef`, `lastUsedAt`) worth keeping.

**Keep the ids in operator copy so every surface names every rule.** Rejected: it puts validator vocabulary in the UI, and the preserved intent — no rule reaches the user unexplained — is kept mechanically by keying `RULE_EXPLANATIONS` with the closed rule-id set.

**Mirror the failure-code union in the overlay's client file.** Rejected: a mirror drifts from the seam. The union is wire vocabulary both faces read, so the shared types outlet is its home.

## Consequences

Every exit works: a second chip click, the close control, and 取消 all leave the gate, and no preset refusal can hold it. One filename can no longer produce two rows, and the kept row retains its connection binding.

The operator reads sentences where rule ids used to print, in both locales, and a rule added to `limits.ts` fails to compile until it has copy. The model-visible `ask-data:limits` paragraph still names the ids, which is where they belong.

`@deepseek-ai/dsh-host-ask-data/client` now also exports `AskDataErrorCode`, and the browser program no longer loads the host face through the overlay. The `limits-copy` exports leave the overlay's `/client` entry. Verification is `packages/experimental/desktop-ask-data/tests/rule-copy.client.spec.ts` for rule and code coverage plus the no-id-leak guard, `sources.spec.ts` for the same-name replace, `data-source-page.client.spec.tsx` for the close control and the sentence surfaces, and `apply.client.spec.ts` for the chip toggle and the refused-revert exit.
