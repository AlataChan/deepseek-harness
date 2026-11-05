# Octopus Implementation Roadmap

**Goal:** Deliver native teamwork, structured persistent questions, and optional Feishu answers in independently verifiable stages.

**Architecture:** Existing Team and Session mechanisms remain the execution system. Stage B1 adds question state and desktop presentation; ordinary human answers use the existing Session prompt path. B2 extends the desktop-owned Feishu connection and existing receipt/reconciliation machinery for explicitly bound card answers.

**Tech Stack:** Cordis, TypeScript, React, storage-domain/SQLite, existing Session controller, Vitest, recorded Sessions, and Tauri packaging.

**Execution status:** A, B0/B1 and B2 source are implemented and locally qualified, including a fresh tested DMG and live Feishu confirmation against the selected private chat. Final independent implementation review remains pending; network and platform qualification limits are recorded. Stage C remains deferred.

## Summary

The complete delivery scope is A, combined B0/B1, and B2. Each has its own plan and acceptance evidence. Stage C has no implementation plan and no scheduled work. The [design](2026-11-03-octopus-human-led-orchestration-design.md) owns product direction; the files below own the implementation sequence.

## Plan sequence

| Order | Plan | Dependency and completion |
| --- | --- | --- |
| 1 | [Stage A native teamwork](2026-11-03-octopus-stage-a-native-teamwork-plan.md) | Independent of B; complete after native workflow, reference validation, and installed skill qualification |
| 2 | [Combined B0/B1 persistent questions](2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md) | B0 source/admission/PTC/Host-test checks precede B1 implementation; useful without IM |
| 3 | [B2 Feishu card answers](2026-11-03-octopus-stage-b2-feishu-decisions-plan.md) | Requires accepted B1 and an authorized test app for platform qualification; synthetic work alone does not establish channel readiness |

Stage A replaces the execution instructions in the [11-02 draft](2026-11-02-native-team-orchestration.md); that draft and its [Cursor review](../../.plans/native-team-orchestration/cursor-review-2026-11-03.md) remain reference artifacts. Do not execute the draft banner or copy its unqualified lifecycle expectations.

## Planning choices

The following choices make the complete B plan concrete. They carry the accepted design forward; B0 must verify their consequences against all affected source consumers. Answers always use `mode: queue` (or receipt-backed `followup`, its next-turn equivalent). Validate before admission; once accepted, preserve human input even if the question later becomes stale.

1. A verified desktop or Feishu answer is full authenticated human input, including the existing human-source checks used by Goal. It grants no exception to tool permission enforcement. Automatic transport bookkeeping and events never acquire `kind: user` by omission.
2. B1 is thin: a structured question card, pending status in existing session navigation, expiry, and normal desktop prompt submission. It adds no background answer dispatcher or second execution queue. The Session log owns admitted answers; the decision aggregate owns question lifecycle, indexing, expiry, and notification references.
3. B2 reuses existing IM receipts and Session reconciliation. Reuse requires a validated asking-session binding; the current IM conversation provider is not an arbitrary-session delivery API. Card answers must not alter free-text IM conversation routing.
4. The desktop owns one Feishu connection per configured channel. Card callbacks use it. Ordinary Feishu text continues into the existing IM session. Card copy explains this distinction.
5. Publishing a persistent question disarms Goal activation without changing its phase to paused. The decision service does not resume it, but a full-human answer turn may let the model resume an active-but-disarmed Goal under current rules. Preserve core's rejection of model resume for a truly paused Goal. Use state-derived copy such as “自动续跑已停止，回答后可能继续”; do not promise that only a manual click can resume. No upstream Goal restriction is added.
6. When jobs or delegated work make persistent waiting unsafe, the question tool returns a typed refusal instructing the model to ask in ordinary chat, or wait for owned work to finish. It does not cancel teammates or invent durable suspension.

## Work ownership and scope

Keep runtime repairs, skill/snapshots, UI, and distribution changes reviewable separately. Preserve unrelated working-tree edits. Use an isolated implementation checkout when appropriate; no checkout or commit is created by this planning change. Read `docs/architecture.md`, package instructions, and `docs/defensive-patterns.md` before editing their code owners.

Every task specifies a failing acceptance case before its implementation and a focused passing check afterward. Existing behavior probes may pass already; do not rewrite them to force a failure. A documented limitation is not a defect to repair within this scope. Do not invent Team states, treat interruption as termination, treat receipt admission as completion, or widen a review assignment into edits.

The B package is `packages/experimental/session-decisions/`. B0 fixes its supported composition and admission rules. Completion requires service, provider, and consumer roles, dual Host/Client compiler faces, browser-safe types, localized UI, effect-owned registrations, and no dependency from default upstream product composition. Desktop pinning uses existing fork manifests and CLI closure rules.

## Shared acceptance and delivery

Run focused behavior and recorded-session checks for the changed owners. Run documentation and metadata checks when their inputs change. Run aggregate type/lint checks once after the affected slices integrate; run build-dependent checks sequentially so they do not race over shared outputs. Report actual results and distinguish a blocked or interrupted check from a pass.

Each shipped stage follows the established desktop pipeline: `pnpm run build`, `cargo tauri build` from `apps/desktop`, then `bash scripts/build-dmg.sh --arch arm64` from the root. The produced DMG must pass its bundle verifier and a fresh copied-app flow. Include only the platforms actually qualified. Do not substitute an already installed app or an old packaging report for the new artifact.

Keep sanitized evidence under `.plans/octopus-implementation/`: `stage-a/`, `stage-b0/`, `stage-b1/`, and `stage-b2/`. Record selected source revision, commands/results, effective models, Session and receipt identities, relevant artifact hashes, and remaining limits. Do not store credentials, callback secrets, or customer conversations there.

## Deferred work

There is no Stage C implementation plan, outer Task schema, scheduler implementation, new task panel, external executor, automatic business retry, or weight-model training task in this roadmap. Reopen the product design only when a concrete workload demonstrates that Sessions, native Teams, and persistent questions are insufficient.

## Current execution evidence

Current checkpoint: 2026-11-04. The root implementation owner has taken over directly; previous worker records are historical, and no delegated worker is active. The coordination record (`.plans/octopus-implementation/orchestration/run-state.json`, local-only evidence) retains the history and current takeover checkpoint. Complete delivery remains unaccepted until its remaining checks pass.

| Stage | Verified evidence | Remaining acceptance |
| --- | --- | --- |
| A | Native skill and manifest-driven distribution; strict replay-driver coverage (`.plans/octopus-implementation/orchestration/takeover-driver-coverage-final.log`, local-only evidence); 11 strict replay/header cases (`.plans/octopus-implementation/orchestration/takeover-final-strict-replays-r2.log`, local-only evidence). Original captured Team fixture hashes are preserved | Independent implementation review |
| B0 | [Independent source/admission review](../../.plans/octopus-implementation/orchestration/cursor-b0-final-review.md): ready for B1 code, 9/10. Authority, queue and guard obligations are exercised in the implemented tests | Final implementation review |
| B1 | Full Host/tool/Client implementation, R4 stale-generation repair, queued answer ownership, expiry, recovery and truthful uncertainty. 422 package tests and 100% per-file coverage (`.plans/octopus-implementation/orchestration/takeover-feature-coverage-final.log`, local-only evidence); 25 desktop/Feishu Host scenarios (`.plans/octopus-implementation/stage-b2/nullable-sender-host-replay-final.log`, local-only evidence). The entry durability repair prevents aggregate admission before the corresponding human message is flushed to the Session file | Independent implementation review |
| B2 | Generic card ports reuse the sole desktop connection; feature-owned publication, durable authorization generations, reused isolated receipts, shared answer reservation, cold answers, refusal/uncertainty and draining teardown are implemented and covered by the package and Host tests | Independent review; recorded proxy/platform limits |

The feature coverage gate (`.plans/octopus-implementation/orchestration/takeover-feature-coverage-final.log`, local-only evidence) passes 100% statements, branches, functions and lines with the repository's per-file thresholds unchanged. No ignore marker or coverage exclusion was added. Scoped lint (`.plans/octopus-implementation/orchestration/takeover-owned-lint-final.log`, local-only evidence), Host types (`.plans/octopus-implementation/orchestration/takeover-final-host-types-r2.log`, local-only evidence), Client types (`.plans/octopus-implementation/orchestration/takeover-final-client-types.log`, local-only evidence), Client copy ownership (`.plans/octopus-implementation/orchestration/takeover-final-i18n.log`, local-only evidence), and the three updated documentation pairs (`.plans/octopus-implementation/orchestration/takeover-final-pairs-check.log`, local-only evidence) pass.

The full source build (`.plans/octopus-implementation/orchestration/takeover-full-build-nullable.log`, local-only evidence) passes. Generated metadata, Tauri packaging and copied-DMG acceptance pass, with 115 installer checks, 12 copied skill/mail checks, 24 copied question/standing-Team checks and actual startup refresh. The [validation report](../../.plans/octopus-implementation/orchestration/VALIDATION.md) records exact commands/results and artifact identity; acceptance is tracked in the [final gate](../../.plans/octopus-implementation/orchestration/final-gate.md). Earlier installer evidence does not qualify later source. The checkout's unrelated global documentation/intake failures remain separately recorded; unrelated edits are preserved.

The [real Feishu qualification](../../.plans/octopus-implementation/stage-b2/platform-qualification.md) records the nullable secondary-identity repair, its 83 focused tests with 100% normalizer coverage, and the untouched final DMG’s real card, separate ordinary-text conversation/reply, cold restart and one original-Session answer. The final package verifies both the standalone IM bundle and its inlined desktop consumer.

The [review prompt](../../.plans/octopus-implementation/REVIEW_PROMPT.md) requests a source, Host, replay, installer, and real-platform verdict separately. No review launch or previous checkpoint verdict substitutes for the final review.

## Dev Note

This English working roadmap and its three plans are explicitly excluded from bilingual pairing. New package documentation created during implementation follows the normal bilingual policy. Validation commands in the stage plans are future acceptance steps, not tests claimed to have run during planning.

## Team visualization follow-up

The follow-up evidence (`.plans/team-activity-2026-11-04/README.md`, local-only evidence) records stronger running/message indicators, reduced-motion behavior, 37 focused UI tests, light/dark Chromium checks, the latest installer identity and 115 readiness checks. The selected-preset requirement is now explicit in the question package README; actual saved test logs distinguish the original non-question conversation from a newer successful persistent-questions conversation. The standalone startup probe requires the current desktop to be closed; the latest run records that precondition while the packaging runtime-refresh check passes.
