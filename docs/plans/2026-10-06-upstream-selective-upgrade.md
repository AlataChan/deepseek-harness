# Upstream Selective Upgrade Plan (fork master → upstream dsh-v0.2.1-alpha.1)

Mode: integrate
Space: upstream-selective-upgrade
Created: 2026-10-06
Revised: 2026-10-06 (round 2 review integrated)
Architect: pi (draft for owner review)
Status: **DECISIONS 1, 2, 8 TAKEN (2026-10-06); Phase 0 tooling landed. Phase 1 onward still requires owner sign-off.**

Plan Review:
- Round 1 (fable, Reviewer): 13 findings. 9 accepted, 2 corrected with evidence, 1 escalated (which reversed this plan's own staging recommendation).
- Round 2 (fable, Reviewer): 4 blocking + 6 significant/minor. All accepted; 1 detail corrected (v3→v4 does not refuse unknown ignorable events — it namespaces and retains them). One blocking finding escalated into a product decision about the fork's **currently shipped** telemetry default.

**Goal:** Bring the useful parts of upstream `origin/master` (5755 commits ahead; last fork sync 2026-09-03) into octopus_DSH, keep the fork's Tauri desktop and its product layer intact, and use the same pass to retire the fork's structural defects: undocumented patch debt against upstream, and a hand-rolled DMG pipeline that duplicates upstream's own packaging pipeline.

**Architecture:** Overlay for product selection, merge for history. Git history is merged wholesale from a pinned tag — the engine is a package graph with a versioned session format, so commit-level cherry-picking costs more than whole-tree merging. What is *selected* is the composition: which upstream packages are mounted in the fork's boot profiles, and **at which endpoint**. Every fork delta therefore exists as an overlay package, a registered patch, or a composition decision recorded in the intake registry. The intake rule is a closed five-class taxonomy (A/B/C/D/E) with a mechanical gate, so "selective" is enforceable rather than aspirational.

**Tech Stack:** TypeScript ESM Cordis plugins, `@deepseek-ai/schemastery` Config, Vitest, recorded-session snapshots (session / ACP / SDK / Web), Loader composition specs, pnpm workspaces, Tauri 2 desktop shell (retained), `packages/session/session-format-*` migration chain (`v0 → v4`), `scripts/verify-desktop-bundle.sh`.

**Reference documents:** `.agents/notes/README.md`, `docs/AGENTS.md`, `packages/AGENTS.md`, `.agents/skills/dsh-pre-push-checks/SKILL.md`, `docs/testing.md`, and the existing telemetry decisions `.agents/notes/implemented/feature/2026-08-25-feedback-gated-telemetry-default.md`, `2026-08-10-telemetry-default-off.md`, `2026-07-31-web-telemetry-default-mount.md`.

## New findings that need a product decision, not just a plan fix

Round 2 surfaced two things that are about the fork's **current** product, not about the upgrade. They are promoted here so they are not buried in Phase detail.

**F1 — the fork already ships a telemetry path to a DeepSeek collector.** `packages/bundle/base/cordis.patch.yml` mounts `@deepseek-ai/dsh-session-telemetry-otel` with an endpoint default of `https://harness-telemetry.deepseeksvc.com/v1/logs`, mode `FEEDBACK_ONLY`. This is a recorded, deliberate decision (`.agents/notes/implemented/feature/2026-08-25-feedback-gated-telemetry-default.md`). What that note itself records about the current behaviour:

- Nothing uploads before the user records `/feedback`; recording feedback uploads the not-yet-shared session-log records.
- Released exports are **the raw captured copy** — the shipped base mounts no `session-telemetry/record` redaction rule, "so they can contain message text, tool arguments and results, and workspace paths".
- The sharing disclosure appears in the `/feedback` acknowledgement — "so the user reads it after the release has been triggered".
- The note states plainly: "A deployment that requires prior informed consent must override the default to `DISABLED` or add a pre-upload confirmation **before this default is defensible there**."

This plan does not overrule that decision. But the fork's stated product premise is a self-hosted tool where the user only configures an API key, and this default sends raw session records to a third-party collector on a user action whose disclosure arrives afterwards. **That is decision point 8.**

**F2 — `~/.dsh` is not desktop-private.** The Phase 2 backup cannot be guarded only at companion boot. `packages/util/home-paths` resolves `~/.dsh` (or `$DSH_HOME`) for every process, so the `dsh` CLI and the Python SDK can open — and migrate — the same session data before any desktop process starts. See decision point 9.

## Decisions taken (2026-10-06)

**1 — Pin: staged hops.** Three engine merges, so the session-format chain is validated in three passes instead of one. Hop sequence: `dsh-v0.1.3-alpha.1` (v0→v2), `dsh-v0.1.5-alpha.1` (v2→v3), `dsh-v0.1.7-alpha.1` (v3→v4), then `dsh-v0.2.1-alpha.1` for engine/client catch-up. No hop isolates v0→v1 from v1→v2, because no tag exists between them.

**2 — Class D: `ssh`, `browser-use` and `computer-use` enter the default composition.** This is a fork composition addition, not an upstream default: upstream mounts none of the three in `bundle/base` or `bundle/web-app`. Verified consequence for the size concern that motivated the earlier recommendation against it: `@deepseek-ai/dsh-browser-use` and `@deepseek-ai/dsh-computer-use` declare no runtime dependencies, and `@deepseek-ai/dsh-fs-ssh` declares only `schemastery` and `zod`. No browser engine, media runtime, or other heavyweight payload enters the DMG, so the fork's size-sensitivity rule is not breached. Two obligations follow: each becomes a registry mount row rather than a silent addition, and each needs fork-owned coverage, because upstream exercises none of them in a default profile.

**8 — Telemetry: default `DISABLED`.** Chosen over a self-hosted default because there is no collector the fork controls, and a default endpoint nobody runs is not a default. `FEEDBACK_ONLY` remains fully functional as an explicit opt-in for operators who set `DSH_TELEMETRY_MODE` and point `DSH_TELEMETRY_OTLP_URL` at their own collector. The reasoning that decides it: the 2026-08-25 note justified feedback-gated uploading as making a `/feedback` report diagnosable, which is true only when the receiver serves the people who can act on it. Here the receiver is upstream's collector, which this fork's maintainers cannot read, so the upload produces no diagnostic benefit and does expose raw session records. `DISABLED` is therefore the default, and it restores the earlier [default-off decision](../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md) for the fork's own deployment. Superseding the 2026-08-25 note is an explicit Phase 1 task, not a side effect.

**3–7, 9 — still open.** They gate Phase 3 (3, 4), Phase 4 (5), and Phase 2's guard (9). Decision 7 has a recommendation: option (a).

## Review Integration

### Round 2

| # | Finding | Disposition |
|---|---|---|
| B1 | Phase 2 patches too small a set — every migration edge has its own inventory | **Accepted.** All four edges are affected. Problem statement, registry, checklist and decision point 7 rewritten around the full set. One detail corrected below. |
| B2 | The "v0 is ambiguous" section misses that fork-v0 is a superset of upstream-v0 | **Accepted**, and it settles decision point 7. Because the fork's only session-event delta is four added event types, a superset decoder accepts both log families with no routing — which is exactly what option (b) could not do. **Recommendation is now (a).** The residual ambiguity (upstream's *released* v0 inventory ≠ merge-base-era v0) is kept and given a fixture requirement. |
| B3 | The staging reversal overgeneralizes | **Accepted.** True only of the four tags examined in round 1. Real session-format hops exist. Open question 1 rewritten to compare them. |
| B4 | Telemetry class C contradicts the existing release closure | **Accepted, escalated.** `packages/telemetry/otel` is a required dependency of upstream's `packages/bundle/base`, so the C label was untenable and gate rule 2 would have failed on the first merge. Reclassified as A-update with a registered gating rule; bundle patch rows added; Phase 4 given a testable endpoint definition. Surfaced as F1 above. |
| S5 | The Phase 4 carve-out is not portable | **Accepted.** Replaced the file list with a per-file import-closure audit and recorded the audit result. |
| S6 | Gate rule 1 flags the fork's own tree | **Accepted.** The registry now resolves by exact upstream-authored path with a fork-ownership marker. |
| S7 | Phase 1 and Phase 3 conflict | **Accepted.** Phase 1 takes the upstream side of the 72 client files; Phase 3 re-adds them as overlays. The intermediate state is explicitly not shippable. |
| S8 | Header arithmetic | **Fixed.** |
| S9 | Backup scope limited to companion boot | **Accepted**, surfaced as F2 and given decision point 9. |
| S10 | A-new lists telemetry as C | **Fixed** — moved out of A-new entirely; covered by B4. |

**Detail corrected in B1.** The reviewer stated that v3→v4 also refuses unknown events. It does not. Its README says it "namespaces unknown ignorable event types and retains each admitted source event's time, message identities, and all fields outside those conversions"; unknown *ignorable* events "retain opaque payload and surface metadata; only their envelope sequence is renumbered." The three refusing edges are v0→v1, v1→v2 and v2→v3. v3→v4 is permissive toward ignorable unknowns. This matters because it is the only edge where the fork's events might pass unmodified — and it depends on whether fork-written logs carry `ignorable: true`, which must be read off a real log rather than inferred.

### Round 1

Accepted and integrated: the frozen-inventory problem (1); the `packages/feedback` contradiction (2); Checklist A provenance (3); the missing label for upstream deletions (4); the Phase 4 / C-table inconsistency (5); unclassified `apps/desktop-host` and `packages/host/*` (6); the architecture-vs-Phase-1 wording conflict (7); the client patch count (8); the gate script convention (9); the unnamed data directories (10); the overstated Agent Note claim (11); and finding 12, which escalated.

**Correction C — round 1, finding 5.** The reviewer stated "no `prepare-runtime` exists". It does: `apps/desktop/scripts/prepare-runtime.ts` and `prepare-runtime-manifests.ts`. Round 2's S5 supersedes this row's fix entirely by replacing the list with an import audit.

**Correction D — round 1, finding 2.** The reviewer asked to narrow C to "upstream's new questionnaire/device-info sub-package... inside `packages/feedback/`". No such sub-package exists; both trees contain exactly `packages/feedback/{command-feedback,message-feedback}`, and `device-info.ts` lives in `apps/desktop/src/`. `packages/feedback` was removed from C.

Verified baseline is cited by quoted text rather than line numbers; line citations rot when upstream rewrites a document.

## Verified baseline

Read from this repository on 2026-10-06.

| Fact | Value | How it was read |
|---|---|---|
| Merge base | `76fda72979` (2026-09-03) | `git merge-base master origin/master` |
| Upstream-only commits | 5755 | `git log --oneline master..origin/master \| wc -l` |
| Fork-only commits | 52 | `git log --oneline origin/master..master` |
| Fork footprint outside `experimental/` | 271 files, +27579 / −251 | `git diff --numstat` |
| …of which edit upstream code (any deletion) | ~76 files | same, filtered `$2>0` |
| `packages/client` changed files | **72**, of which **26** have deletions | `git diff --name-only` / `--numstat` (all 72 are already non-experimental) |
| Fork overlay files | 378 in `packages/experimental/` | `git diff --name-only` |
| Client packages changed upstream since merge base | 2152 | `git diff --name-only -- packages/client` |
| Session format at merge base | `v0` | `git grep 76fda72979 -- packages/core/session/src/types.ts` |
| Session format, fork | `v0`, and by its own README "this build provides no format-migration path" | `packages/session/session-persistence/README.md` |
| Session format, upstream head | `v4` | `packages/core/session/src/types.ts` |
| **Session format per tag** | `≤dsh-v0.1.2-rc.1` → **v0**; `dsh-v0.1.3-alpha.1/2` → **v2**; `dsh-v0.1.5-alpha.1` … `dsh-v0.1.6-alpha.2` → **v3**; `dsh-v0.1.7-alpha.1` … `dsh-v0.2.1-alpha.1` → **v4** | `git grep 'SESSION_FORMAT_VERSION = '` per tag |
| Hop tags are after the merge base | `dsh-v0.1.3-alpha.1` (09-04), `dsh-v0.1.5-alpha.1` (09-08), `dsh-v0.1.7-alpha.1` (09-22) are all **not** ancestors of the merge base | `git merge-base --is-ancestor` |
| No tag at v1 | v0→v1 and v1→v2 land together within the `dsh-v0.1.3-alpha.*` cycle | tag scan above |
| Fork custom session events | `ask-data/bound`, `ask-knowledge/bound`, `ask-knowledge/unbound`, `commerce/bound` | `packages/core/session/src/known-event-types.ts`; the only session-event delta in the fork is those four lines |
| Fork data root (Tauri app data) | identifier `studio.octopus.dsh`, productName `octopus_DSH` → `~/Library/Application Support/studio.octopus.dsh` | `apps/desktop/src-tauri/tauri.conf.json` |
| Fork data root (Harness home) | `DSH_HOME_DIR_NAME = '.dsh'`, default `join(homedir(), '.dsh')`, overridable by `$DSH_HOME` → `~/.dsh` | `packages/util/home-paths/src/index.ts` |
| Fork telemetry mount | `bundle/base/cordis.patch.yml` mounts `session-telemetry-otel`, mode `FEEDBACK_ONLY`, endpoint default `https://harness-telemetry.deepseeksvc.com/v1/logs` | the bundle file; decision recorded in the 2026-08-25 Agent Note |
| Upstream telemetry mounts | `bundle/base` mounts `dsh-otel` **and** `session-telemetry-otel` (default `https://dsh-otel-collector.deepseeksvc.com/v1/logs`); `bundle/web-app` depends on `dsh-host-product-telemetry-otel` and `dsh-otel` | `origin/master` bundle files |

### Correction to an earlier claim (record this, it changes the desktop decision)

An earlier reading in this session stated that upstream "replaced Tauri with Electron". **That is wrong, and the corrected version is more favorable to the fork.**

- At the merge base, upstream's `apps/` contained only `cli` and `web`. Upstream had **no desktop application at all**.
- Upstream's `apps/desktop` was created on the branch `feat/electron` (first commit `19444907f0`, authored 2026-08-28, subject `feat: electron 打包`) and **merged into upstream master after 2026-09-03**. Electron from the first commit; upstream never had a Tauri shell.
- The fork's Tauri desktop is **entirely fork-authored**: every `apps/desktop/src-tauri/**` path is an addition against the merge base.

Consequence: `apps/desktop` is a **path collision between two independent products**, not an upstream evolution the fork declined to follow. There is no "upstream Tauri desktop" to stay aligned with, and no migration to perform.

### Evidence that the client layer does not require Electron

1. Upstream runs the same client packages in a plain browser: `apps/web/tests/agent-team-panel.overlay.yml` inserts `@deepseek-ai/dsh-experimental-client-ui-agent-team` into the Web bundle, and `apps/web/tests/agent-team-panel.e2e.ts` drives it with no Electron present.
2. Upstream declares the shell boundary explicitly: `packages/client/ui-settings-general/src/client/shell-contract.ts` takes its only shell-provided input as `carrier?.protocolVersion === 1 ? carrier.updates : undefined` — optional, and a shell providing no `carrier.updates` renders no update UI.
3. Only one client package touches a shell bridge: `ui-directory-picker-native`, whose README documents the official Host-side fallback.

Scope of the claim: the **UI layer** is shell-agnostic. The **transport layer** is not, and the fork already owns its own.

## Non-goals

1. **No wholesale takeover.** Upstream's release cadence and product judgement do not become the fork's.
2. **No Electron migration.**
3. **No new upstream business surface** — no account binding, no product analytics, no remote policy gate, no self-update feed. This constrains *intake*; it does not retroactively change the fork's own recorded telemetry default (F1).
4. **No "pick commits" model.** Selection happens at package and composition granularity.

## Intake taxonomy (the closed rule)

| Class | Meaning | Handling |
|---|---|---|
| **A** | Engine / capability package, direction-neutral | Take. Pin in the base composition. A change that cannot be expressed without editing an upstream file is an A **with a registered patch** — reason and owner required. |
| **B** | Client UI package or official slot | Take, but **only through declared slots**. The fork must not edit the upstream file. |
| **C** | Shell / account / remote control / release feed, or a **telemetry mount pointed at an upstream collector** | **Never merged**, and never mounted. Classification is by **mount and endpoint**, not by package name (round-2 B4). |
| **D** | Vendor product direction that conflicts with the fork's premise | Judged case by case, default no, reason recorded. |
| **E** | Upstream **removed** a package that existed at the merge base | Explicit decision per package: follow the deletion / keep as fork-owned / move to `experimental/`. Silent retention is not an option. |

Two hard boundaries that round 2 proved necessary:

1. A B-class item that cannot be expressed without editing an upstream file is **not** a B; it is an A with a registered patch, or it is declined.
2. **A telemetry package is not classified by its name.** `packages/telemetry` is a required dependency of `packages/bundle/base`; `session-telemetry-otel` already ships in the fork. What matters is whether a row is mounted and where its endpoint points. Classifying by package name produced a C row that contradicted the release closure.

## Global constraints

- **Core.** No hand-written change to `packages/core/*`, `agent-loop`, the LLM seam, or core `SessionEventMap` members, **except** the Phase 2 migration patch named there. The fork's four custom events already exist and stay.
- **Official product packages.** No edit to official `apps/desktop`, `packages/bundle/desktop-app`, or desktop-companion product logic beyond what Phase 4 registers.
- **Experimental dependency rule.** Release packages, apps, and harness-resolved preset rows name no `packages/experimental/*` package.
- **Desktop shell is retained, not migrated**, with the Phase 4 porting carve-out as the single exception.
- **C-class invariants are mechanically checked.**
- **Pre-release stance applies** — with the Phase 2 caveat that "no compatibility shims" governs formats *between harness versions*, while data already written by a shipped DMG is still the user's data and must be readable.

---

# Phases

## Phase 0 — Ledger, provenance, and the two product decisions

**Actions**

1. This document, reviewed and approved.
2. `docs/plans/2026-10-06-upstream-intake-registry.md` — the working ledger: every C-class mount and path, every B-class slot mapping, every registered patch with a reason and an owner, every E-class decision, and every telemetry mount with its resolved endpoint.
3. An Agent Note **recording the `apps/desktop` provenance finding** (not a reversal — `AGENTS.md` carries the Tauri fact without reasoning; the note supplies the reasoning so the question is not reopened).
4. `AGENTS.md` "Learned Workspace Facts" updated with the same provenance.
5. Resolve **decision point 8** (telemetry endpoint and consent) and **decision point 9** (which layer owns the pre-migration guard). Records become registry entries.
6. Decide which process owns the Phase 2 backup-or-stop. The honest scope limit is F2: a guard at companion boot does **not** cover the `dsh` CLI or the Python SDK opening the same home. Either move the guard to the persistence layer, or record the limitation explicitly.

**Exit gate**

- Owner has approved this plan; the registry exists; decision points 8 and 9 are answered; the backup layer is named.
- `pnpm run test:docs` passes.

## Phase 1 — Pin upstream and take the engine

**Actions**

1. Pin upstream at the chosen tag (decision point 1). Branch from fork `master`.
2. Merge upstream. Resolve `apps/desktop` in favour of the fork's tree; apply the Phase 4 porting carve-out; drop or resolve C-class paths and mounts as they appear.
3. **Client files: take the upstream side.** For the 72 changed `packages/client` files, do not attempt to preserve the fork's edits here — Phase 3 re-adds every one of them as an overlay. This resolves the round-2 S7 conflict: Phase 1 does not have to keep fork UI working.
4. Classify every conflicted path into A/B/C/D/E and record it. A conflict is the mechanism by which this list gets built.
5. Decide each E-class removal explicitly.
6. Add `scripts/verify-upstream-intake.ts` + `.spec.ts`, register a package.json script, and wire it into the **hygiene / package-dependencies** group in `scripts/run-gates.ts` via `pnpmScript(...)`.
7. Get the engine and non-UI packages compiling and green.

**Explicitly accepted consequence of step 3:** the fork's UI is degraded between Phase 1 and Phase 3. **No DMG is cut, and no release is published, in that window.** Phase 1's exit gate is a compiling, test-green engine across both faces, not a working product.

**Exit gate**

- `pnpm run typecheck` and `pnpm run test` green.
- `pnpm run hygiene` green, including the new intake gate.
- `scripts/verify-upstream-intake.spec.ts` **proves the gate rejects a seeded violation**, and is run against the real post-merge tree so it is known to pass there too.
- Every E-class package has a recorded decision; none is silently retained.

### The intake gate, concretely

`scripts/verify-upstream-intake.ts` reads the registry as its source of truth:

1. **Upstream-authored paths.** The registry stores exact upstream-authored paths, each marked either `never-merge` or `fork-owned`. The check is that no `never-merge` path is present in the tree. It does **not** flag `apps/desktop/**` wholesale, because that path is fork-owned (round-2 S6).
2. **Release-closure exclusion, by mount and endpoint.** No composition in the release closure mounts a telemetry or account row whose resolved endpoint is an upstream collector, unless the registry carries a decision for it. This replaces the earlier package-name check, which could not survive the first merge (round-2 B4).
3. **Patch registry completeness.** Every file the fork edits relative to upstream appears in the registry with a reason.
4. **E-class decisions.** Every registry entry for a package upstream deleted carries a decision.

## Phase 2 — Session format `v0 → v4` with the fork's custom events

The only phase that can destroy user data, and the one both review rounds found understated.

### The problem, stated precisely

Upstream's migration is a chain of **four independently frozen packages**, each with its own event inventory and its own disposition for unknown events. Verified from each package's README:

| Edge | Package | Unknown-event disposition |
|---|---|---|
| v0 → v1 | `session-format-v0-to-v1` | "refuses every event type outside its frozen inventory, **including an unknown event marked `ignorable: true`**"; known limits: "**Closed first-party inventory** — unknown external-plugin events refuse migration" |
| v1 → v2 | `session-format-v1-to-v2` | "**Closed first-party source inventory** — an unknown v1 event refuses migration, including an event marked `ignorable: true`" |
| v2 → v3 | `session-format-v2-to-v3` | "Unknown events, even ignorable ones, and unaudited members at checked records are refused" |
| v3 → v4 | `session-format-v3-to-v4` | **Permissive**: "namespaces unknown ignorable event types and retains each admitted source event's time, message identities, and all fields outside those conversions"; unknown ignorable events "retain opaque payload and surface metadata; only their envelope sequence is renumbered" |

The source inventories live in each package (v0→v1 in `src/dispositions.ts` with `payload-validation.ts` and `relationships.ts`; the later edges carry their own equivalents). The fork's four events appear **nowhere** in `packages/session/*` upstream.

So: **three edges refuse the fork's events outright, and the fourth may accept them.** Whether v3→v4 accepts them depends on whether fork-written logs carry `ignorable: true` — the fork's events are declared as ordinary required-on-read `SessionEventMap` members in `packages/host/ask-data/src/types.ts` and `packages/host/commerce/src/types.ts`, while `ignorable?: true` is an optional envelope flag set by the writer. **This must be read off a real fork-written log, not inferred from the type declarations.** That is a Phase 2 inspection step, and it decides how many packages need patching: three, or four.

### Decision point 7 — answer, with the round-2 argument

Round 2 supplies the fact that settles this. The fork's **only** session-event delta against the merge base is the four added event types — nothing else in the fork's session vocabulary diverges. Therefore **fork-v0 is upstream-v0 plus four events**, i.e. a *superset*. A decoder whose inventory is a superset of upstream's frozen inventory accepts both log families with **no routing**.

- **Option (a) — recommended.** Patch the refusing upstream packages to admit the four events. One decoder per edge. Because fork-v0 ⊃ upstream-v0, it reads upstream-authored logs as well, so nothing is lost.
- **Option (b) — rejected.** A fork-owned `v0-fork → v1` edge would have to decide *which* logs are fork logs before it can route them. Since fork-v0 and upstream-v0 are distinguished only by the presence of four optional events, that routing decision is content-sniffing on the data path — strictly worse than a superset inventory, and it does not solve the v1→v2 and v2→v3 problems at all, because those edges would still refuse the events in a log that arrived at v1.

Registry consequence: (a) is **one registered A-class patch per refusing edge**, on the data path. Each entry names the file and the reason, and the registry must be re-checked on every upstream merge.

### The residual ambiguity, and the fixture rule

Upstream's frozen inventory is a decoder for **upstream's released v0**, which is not necessarily the merge-base-era v0 that the fork's shipped DMG wrote. Two consequences:

1. A fixture hand-authored from the current type declarations proves nothing. **The fork-v0 fixture must be generated by an actual shipped DMG build of octopus_DSH** — a real session log written by the released app, containing the four events.
2. An upstream-authored v0 fixture is also required, so the superset claim is tested rather than assumed.

### Reconciliation with the pre-release stance

`AGENTS.md` prefers correct foundations over compatibility shims and permits rejecting old on-disk formats. That governs formats *between harness versions*. It does not license discarding data already written by a DMG users installed. If the two conflict, reading the user's existing data wins, and the conflict is recorded as an Agent Note rather than resolved silently.

### Actions

1. Adopt upstream's migration chain through the pinned tag (or staged hops — decision point 1).
2. **Inspect a real fork-written v0 log** to determine whether its four events carry `ignorable: true`, and therefore how many edges need patching.
3. Patch the refusing edges as registered A-class patches: `dispositions.ts` on v0→v1, the equivalent inventory on v1→v2 and v2→v3, plus `payload-validation.ts` wherever the four payloads need structural validation.
4. Regenerate the persistence catalog and `packages/core/session/src/known-event-types.ts`; `verify-persistence-catalog` gates this.
5. Back up **both** data roots before the new Host first opens old data, at the layer named in Phase 0:
   - `~/Library/Application Support/studio.octopus.dsh`
   - `~/.dsh` (or `$DSH_HOME`)
   Startup stops if the backup fails. See F2 for the scope limit.
6. Retain a rollback path and test it.

### Checklist

| Item | Gate |
|---|---|
| `v0 → v1 → v2 → v3 → v4` chain reaches `currentVersion` | `packages/session/session-format-catalog` specs |
| Each of the four fork events survives **every** edge | new specs, one per edge |
| A **genuine fork-v0 log written by a shipped DMG** migrates | new spec using a captured real log, not a hand-authored fixture |
| A **genuine upstream-authored v0 log** migrates | new spec, proving the superset claim |
| Whether fork events carry `ignorable: true` is recorded | inspection result in the registry |
| Unknown-event refusal still holds for genuinely unknown types | existing catalog specs |
| Backup of both roots exists and is non-empty before the Host opens old data | new test at the layer named in Phase 0 |
| A real legacy profile copy opens and lists every session | manual, on a copied profile |

### Exit gate

- All above green; `pnpm run test:snapshot` green for session, ACP, and SDK surfaces.
- Explicit owner sign-off — a failure here is user-visible data loss.
- **Stop condition:** if a genuine legacy log cannot be read, stop. Do not resolve it by declaring the old format unsupported.

## Phase 3 — UI layer: migrate the fork's client patches onto official slots

Phase 3 exists to **delete** code, and it also restores the UI that Phase 1 deliberately took the upstream side of.

The fork changes **72** files under `packages/client`, **26** with deletions. All 72 re-enter as overlays here.

| Fork's current patch | Official slot now available |
|---|---|
| `ui-sidebar/src/client/{SidebarRoot.tsx,contract/slots.ts,index.ts}` | `ui-sidebar-right`, `ui-dockkit` |
| `ui-conversation/src/client/contract/{slots.ts,input.ts}` | upstream `ui-conversation` slot declarations after the rewrite |
| `ui-conversation/src/client/skeleton/{InputBar.tsx,InputBar.module.css,ConversationRoot.tsx,EmptyHero.tsx}` | upstream `ui-conversation` rewrite; the fork's Hero becomes an additive occupant |
| `ui-conversation/src/client/{apply.ts,input/facade.ts,index.ts}` | official conversation slots |
| `ui-agent-preset/src/client/seat-store.ts` | `ui-agent-preset` (upstream now owns this surface) |
| `extensions/cordis-client-runner/src/client/slot-catalog.ts` | upstream slot catalog; fork slots become overlay registrations |
| brand slot (`小绿鲸` wordmark) | `ui-brand-official` |

**Actions**

1. Move each onto the official slot as an **overlay plugin** — the shape the fork already uses for Agent Team.
2. Register any patch that genuinely cannot move as an A-class patch with a reason.
3. Target: client-layer edits to upstream files drop to zero, or every remainder is registered.

**Exit gate**

- `pnpm run typecheck` — both faces clean; `pnpm run test` green for every overlay package.
- The fork's client patches to upstream files are zero or fully registered.
- A keyless recorded-session snapshot exists for each product-visible surface that changed.

## Phase 4 — Desktop shell: keep Tauri, port selectively

**Actions**

1. Keep `apps/desktop/src-tauri/**` and `apps/desktop/src/**`. Do not merge upstream's Electron tree, **except** the porting carve-out.
2. **Porting carve-out — rule, not a list.** A file may be ported from `apps/desktop/scripts/` only if its **transitive import closure contains no C-class path** — no `@electron/get`, no `desktop-auto-update-environment.mjs`, no `desktop-policy-environment.mjs`, no `../src/**` from upstream's unmerged Electron tree, no `apps/desktop-host/**`. Round 2's audit of the candidate set:

   | File | Import closure | Verdict |
   |---|---|---|
   | `runtime-file-policy.ts` | clean | **port candidate** |
   | `prepare-package-set.ts` | `../src/core-package-set.ts`, `scripts/release/*` | audit `core-package-set.ts` first; otherwise ideas only |
   | `prepare-runtime.ts` | `@electron/get` → downloads and extracts Electron.app | **ideas only** |
   | `prepare-dsh.ts` | `../src/{node-environment,project-manager,host-protocol,release,core-package-set,runtime-tree}.ts`, `desktop-release-environment.mjs` | **ideas only** |
   | `package-target.ts` | `desktop-auto-update-environment.mjs` (release-feed) | **ideas only** |
   | `smoke-packaged-runtime.ts` | `../src/runtime-tree.ts` | ideas only |
   | `smoke-prepared-runtime.ts` | `../../desktop-host/src/office-engine.ts` (C) | **ideas only** |
   | `macos-runtime.ts` | `desktop-release-environment.mjs`, `macos-cache-policy.ts` | ideas only |

   Each ported file becomes a registry entry with a reason. The fork's own DMG assembly and `scripts/verify-desktop-bundle.sh` remain the authority.
3. Preserve the bundle id and both data roots: `studio.octopus.dsh`, `~/Library/Application Support/studio.octopus.dsh`, `~/.dsh` (or `$DSH_HOME`), knowledge libraries, user settings.
4. Re-check every overlay against the new client interfaces: `desktop-ask-data`, `desktop-ask-knowledge`, `desktop-files`, `desktop-media`, `desktop-hero-atmosphere`, `client-ui-agent-team`, `commerce-mode`.
5. Apply the decision-point-8 outcome to the telemetry rows, and remove stale Tauri-era packages when converting an existing profile while preserving user-installed plugins.

**Adopted ideas from upstream's Electron shell (code not taken):** update journal, signature verification, local crash-report files, single-instance handling, quit confirmation.

**Exit gate**

- `scripts/verify-desktop-bundle.sh` passes and produces a DMG.
- A **copied legacy profile** upgrades: both data roots reused, not recreated.
- First launch against that copy does not block and shows no update prompt.
- **Testable telemetry definition** (replacing the round-1 phrase "contacts no telemetry endpoint"): with mode `FEEDBACK_ONLY`, no OTLP request is issued before the user records `/feedback`; with `DSH_TELEMETRY_DISABLED` set, no OTLP request is issued at all. Verified by an assertion on the exporter, not by observation.

## Phase 5 — Verification, size, and release

1. `pnpm run test:coverage`, `pnpm run doc-sync`, `pnpm run hygiene`, `pnpm run test:snapshot`.
2. Real-API e2e for any provider path touched.
3. Measure app and DMG size and record it. Not a blocker.
4. Write the Agent Note(s).
5. Merge to `master`; push to `fork` and the Gitee mirror.

**Exit gate:** all commands reported with actual output; the Phase 1 gate re-run with no C-class regression; DMG installable and self-verified by the builder.

---

# Checklists

## A-update — existed at the merge base; upstream has new work

| Package | Note |
|---|---|
| `packages/jobs`, `packages/workspace`, `packages/spill` | update |
| `packages/plan`, `packages/goal`, `packages/schedule` | update (UI is B) |
| `packages/attachment` | update |
| `packages/session-query`, `packages/storage` | update |
| `packages/sandbox` | update; relevant to the fork's fencing work |
| `packages/mcp` | update; already composed, so the round-1 D question is moot |
| `packages/host/webserver`, `host/frontend-static` | update; the web host path |
| `packages/host/directory-picker-native`, `host/directory-picker-browse` | update; **`ui-directory-picker-native`'s Host fallback lives here** — this is the package that keeps Tauri viable |
| `packages/host/plugin-inventory` | update |
| `packages/feedback/command-feedback`, `packages/feedback/message-feedback` | update; already mounted in `bundle/base` and `bundle/web-app`; **not** C |
| `packages/session/session-telemetry-otel` | update; **already mounted in the fork** — see decision point 8 |
| `packages/telemetry` (`dsh-otel`) | update; **required dependency of upstream's `bundle/base`** — see the taxonomy boundary and decision point 8 |
| `packages/extensions/*` additions | update |

## A-new — genuinely new upstream packages

| Package | Suggested | Decision |
|---|---|---|
| `packages/document` | take | _(review)_ |
| `packages/deliverables` | take engine; UI is B | _(review)_ |
| `packages/ptc-runtime` | take | _(review)_ |
| `packages/ssh` | judge | _(review)_ |
| `packages/browser-use` | judge (D-adjacent) | _(review)_ |
| `packages/computer-use` | judge (D-adjacent) | _(review)_ |
| `packages/host/open-in-app` | take | _(review)_ |

`packages/telemetry` and `packages/host/product-telemetry-otel` are **not** in this table; they are covered by A-update and decision point 8.

## B — Take through official slots only

| Upstream package | Fork's need it serves | Intake |
|---|---|---|
| `ui-sidebar-right`, `ui-dockkit` | replace the hand-built collaboration pod's layout code | slot, overlay plugin |
| `ui-brand-official` | 小绿鲸 brand slot | slot, asset only |
| `ui-agent-preset`, `ui-model-selection` | open teammate model selection; panel must match actual selection | slot, overlay plugin |
| `ui-settings-*` (9 packages) | settings legible to ordinary users | take; fork Chinese path becomes an overlay (decision point 3) |
| `ui-trajectory` | Agent Team topology view | slot |
| `ui-plan`, `ui-goal`, `ui-schedule`, `ui-deliverables` | plan/goal/schedule surfaces | slot |
| `ui-plugin-manager` | community marketplace — **optional setting only, never in default boot** | take, not mounted by default |
| `ui-message-feedback`, `ui-attachment`, `file-upload`, `ui-open-in-app`, `ui-shortcuts`, `ui-theme` | general UX | take |
| `ui-directory-picker-native` | workspace directory flows | take; fork supplies the Host path |

## C — Never merged, never mounted

| Path / mount | Tag | Reason |
|---|---|---|
| `apps/desktop/**` (upstream Electron tree) | shell | Path collision with the fork's fork-authored Tauri shell. Phase 4 carries the porting carve-out |
| `apps/desktop-host/**` | shell | Upstream's private Electron Node host; part of the same Electron product |
| `apps/desktop/src/account-backend.ts`, `platform-view.ts`, `platform-ipc.ts`, `preload-platform*.ts`, `login-shell-environment.ts`, `policy-test-auth.ts` | account-binding | Binds the client to a DeepSeek account |
| `apps/desktop/src/mandatory-update-*.ts`, `preload-mandatory*.ts`, `renderer/mandatory-update*`, `renderer/policy-login-loading.html` | policy-gate | Remote, fail-closed block on startup |
| `apps/desktop/src/update-*.ts`, `desktop-auto-update-*` | release-feed | Points at upstream's release origin |
| `apps/desktop/src/device-info.ts` | product-analytics | Machine description attached to the desktop feedback questionnaire |
| `packages/client/product-analytics` | product-analytics | Upstream's README: reports "by default, **without a user-facing control**"; `enabled` defaults to `true`; carries `user_id` / `device_id` |
| `packages/host/product-telemetry-otel` **as a mount** | product-analytics | Mounted by upstream's `bundle/web-app`; the package may be updated, the mount is not taken |
| Upstream's `dsh-otel` **mount at `dsh-otel-collector.deepseeksvc.com`** | product-analytics | The mount and endpoint are not taken; the package is updated (A-update) |
| `apps/desktop/scripts/desktop-cos*`, `installed-update-*`, `electron-builder.config.*`, `installer/**`, `upload-target*` | release-feed | Upstream's signed release pipeline against their CDN |
| `electron-updater`, `electron`, `electron-builder`, `@electron/*` | shell | Dependencies of the above only |

The fork may adopt the **ideas** behind the release rows — update journal, signature verification, a local crash-report file — without adopting any of the machinery.

## D — Judged case by case, default no

| Item | Why it needs a decision |
|---|---|
| `packages/ssh` | Direction-neutral, but widens the credential surface in a self-hosted tool |
| `packages/browser-use`, `packages/computer-use` | Powerful; the fork's premise is a light local tool |
| `ui-plugin-manager` + community marketplace | Recorded preference: optional setting only, never default boot. Confirm |
| Upstream's `apps/web` product isolation and analytics wiring | Check whether either drags in a C-class mount |

## E — Upstream removed it; the fork still has it

Confirmed by set difference between the merge base and `origin/master`.

| Package | Fork status | Decision required |
|---|---|---|
| `packages/e2b` | present in fork | follow the deletion / keep as fork-owned / move to `experimental/` |
| `packages/code-runtime` | present in fork | same |
| `packages/runtime-diagnostics` | present in fork | same |

Each decision records what replaces the package upstream (if anything) and whether the fork still has a caller.

## Patch registry (the fork's debt, to shrink)

| Upstream file | Change | Class | Target |
|---|---|---|---|
| `packages/api/session-controller/src/index.ts` | +485/−1 | A | keep; ask-data / ask-knowledge / commerce remotes |
| `packages/api/session-controller/src/agent.ts` | +32/−1 | A | keep; review against upstream's newer controller |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | +354/−23 | **B** | migrate: fork slots become overlay registrations |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | +306/−30 | **B** | migrate |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | +144/−4 | **B** | migrate |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` | +124/−1 | **B** | migrate |
| `packages/client/ui-conversation/src/client/{apply.ts,input/facade.ts,contract/input.ts,index.ts}` | +51/−38 | **B** | migrate |
| `packages/client/ui-conversation/src/client/skeleton/{ConversationRoot.tsx,EmptyHero.tsx}` | +28/−6 | **B** | migrate; Hero becomes an occupant |
| `packages/client/ui-sidebar/src/client/{SidebarRoot.tsx,contract/slots.ts,index.ts}` | +86/−10 | **B** | migrate to `ui-sidebar-right` / `ui-dockkit` |
| `packages/client/ui-agent-preset/src/client/seat-store.ts` | +20/−2 | **B** | migrate to upstream's `ui-agent-preset` |
| `packages/session/session-format-v0-to-v1/src/dispositions.ts` (+ `payload-validation.ts`) | pending | **A** | **Phase 2 data path** — one entry per refusing edge (v0→v1, v1→v2, v2→v3), decided in Phase 2 step 2 |
| `packages/bundle/base/package.json`, `bundle/base/cordis.patch.yml` | pending | **A** | telemetry mount and dependency — resolved by decision point 8 |
| `packages/bundle/web-app/package.json`, `bundle/web-app/cordis.patch.yml` | pending | **A** | same |
| `packages/fs/fs/src/{index.ts,invariant.ts}`, `fs-observation-policy/src/index.ts` | +40/−3 | A | keep; reason required |
| `packages/fs/tool-fs/src/{error.ts,read.ts,read-target.ts,read-image.ts,write.ts,edit.ts}` | +34/−8 | A | keep; review against upstream |
| `packages/fs/tool-str-replace-editor/src/index.ts` | +5/−5 | A | keep |
| `packages/boot/app-boot/src/profile.ts` | +38/−8 | A | keep; the fork's profile resolution |
| `packages/web/tool-web/src/{search.ts,fetch.ts,trust.ts}` | small, incl. `−7` | A | keep |
| `packages/subagent/subagent/src/child-agent.ts` | +1/−1 | A | keep |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | +2/−2 | A | keep |
| `packages/core/system-prompt/tests/system-prompt.spec.ts` | +2/−1 | A | keep (fork prompt order) |
| `apps/cli/{package.json,tsdown.config.ts}`, `apps/web/tsconfig.json`, `packages/api/session-controller/tsconfig.host.json` | build config | A | keep, re-derive after the merge |
| README / `.i18n.yaml` under `packages/*`, `packages/client/ui-*`, `packages/acp`, `packages/guard`, `packages/host` | doc text | — | fork text re-applied after upstream rewrites; `doc-sync` gates the result |
| `apps/desktop/**` | fork Tauri shell | — | fork-owned; upstream tree not merged except the Phase 4 carve-out |

---

# Risk register

| Risk | Severity | Detection | Response |
|---|---|---|---|
| Old sessions unreadable after migration | **critical** | a real legacy-profile copy fails to list or open sessions | **STOP.** Never resolve by declaring the old format unsupported |
| A refusing edge silently rejects fork-written logs | **critical** | a fork-v0 fixture fails while an upstream-v0 fixture passes | Patch the refusing edges; both fixtures are required gates |
| The v0 fixture proves nothing because it was hand-authored | **high** | fixture not produced by a shipped DMG build | Fixture rule in Phase 2; a captured real log or no gate credit |
| Rollback impossible once data is migrated | **high** | migrated session opened by the previous release | Keep the pre-migration backup of both roots; document and test the rollback |
| C-class mount imported unnoticed | high | intake gate rule 2, by mount and endpoint | Fail the gate; drop the mount |
| Patch debt regrows during the merge | medium | registry count after Phase 3 | A B that needs an upstream edit is not a B |
| An E-class package is silently retained | medium | intake gate rule 4 | Decide per package; record the replacement or the fork ownership |
| A client package starts requiring a shell capability Tauri lacks | medium | Phase 4 exit gate | Implement in Tauri, or decline and record |
| A ported packaging file drags a C-class dependency in through a later edit | medium | import-closure rule re-checked at Phase 4 exit | Re-audit on change; `@electron/get` is the specific trap |
| Staging multiplies sessions without isolating the risk | medium | a hop's session version equals the next hop's | Decision point 1 compares real hops; no hop isolates a single edge |
| Fork UI is degraded between Phase 1 and Phase 3 | medium | accepted by design | No DMG and no release in that window |
| Bilingual docs drift as upstream rewrites theirs | low | `pnpm run doc-sync` | Re-apply fork text; do not disable the gate |

---

# Verification gates

| Command | Covers |
|---|---|
| `pnpm run typecheck` | both compiler faces, all overlays |
| `pnpm run test` | unit + package suites |
| `pnpm run test:coverage` | the CI coverage gate |
| `pnpm run test:snapshot` | keyless recorded-session replay through shipped profiles |
| `pnpm run test:e2e` | real-API paths (self-skips without `DEEPSEEK_API_KEY`) |
| `pnpm run doc-sync` | every documentation gate |
| `pnpm run hygiene` | workspace/package/dependency checks, **including the new intake gate** |
| `scripts/verify-desktop-bundle.sh` | the DMG hard gate |
| `scripts/verify-upstream-intake.ts` + `.spec.ts` (new) | upstream-authored-path check, mount-and-endpoint exclusion, patch-registry completeness, E-class decisions |

---

# Deliverables

1. This plan and the intake registry, approved.
2. An Agent Note recording the `apps/desktop` provenance finding and the intake taxonomy.
3. `AGENTS.md` "Learned Workspace Facts" corrected on `apps/desktop` provenance.
4. `scripts/verify-upstream-intake.ts` + spec, wired into the hygiene gate group, proven to reject a seeded violation and confirmed to pass on the real post-merge tree.
5. A green merge on `master`, pushed to `fork` and the Gitee mirror.
6. A DMG built, verified against `verify-desktop-bundle.sh`, and tested against a copied legacy profile.
7. Recorded app and DMG sizes.

---

# Open questions — the owner's decisions before execution

**1. Pin target.** Round 1 concluded staging could not reduce session risk; round 2 showed that was true only of the four tags then examined. Real session-format hops exist, all after the merge base:

| Hop | Tag | Format | What it isolates |
|---|---|---|---|
| 1 | `dsh-v0.1.3-alpha.1` (09-04) | v0 → **v2** | the v0→v1 and v1→v2 edges **together** — no tag exists between them |
| 2 | `dsh-v0.1.5-alpha.1` (09-08) | v2 → **v3** | the v2→v3 edge |
| 3 | `dsh-v0.1.7-alpha.1` (09-22) | v3 → **v4** | the v3→v4 edge |
| 4 | `dsh-v0.2.1-alpha.1` | v4 → final | no format change; engine/client catch-up only |

Staging therefore **does** buy incremental session validation: three separate verifications instead of one, and the first hop is the only one that has to carry two edges at once. It costs three extra engine merges. **Recommendation: stage, if the owner accepts three merges.** If not, one pin at `dsh-v0.2.1-alpha.1` with all three edges validated in a single pass.

**2. Class D defaults.** `ssh` and `browser-use` / `computer-use` out of the default composition? Plugin marketplace stays optional, not default boot? (`mcp` is settled.)

**3. Chinese-first settings.** Overlay the Chinese text on upstream's 9 `ui-settings-*` packages, or re-derive a single Chinese settings path? Decides whether they are B or D.

**4. UI copy ownership.** The fork's rule is locale-owned client UI copy. Confirm the overlay layer owns fork copy and upstream packages keep theirs.

**5. Knowledge sidecar.** Confirm `desktop-ask-knowledge`'s Python sidecar stays in scope through Phase 4.

**6. Agent Note scope.** Recommendation: two notes — one for provenance plus taxonomy, one for the session migration.

**7. Session migration path — answered, pending owner confirmation.** Patch the refusing edges (option (a)), because fork-v0 is a strict superset of upstream-v0 and a superset decoder needs no routing. Requires the captured-real-log fixture. Confirm, or explain what would make (b) preferable.

**8. Telemetry endpoint and consent — ANSWERED, option (b), applied.** The fork shipped `FEEDBACK_ONLY` pointed at `https://harness-telemetry.deepseeksvc.com/v1/logs`, which uploaded raw session records — message text, tool arguments and results, workspace paths — to a collector its maintainers cannot read, with the disclosure shown after the release. The base now resolves an unset `DSH_TELEMETRY_MODE` to `DISABLED` and carries no endpoint default; an upload mode is an explicit opt-in that must name an endpoint, and one without an endpoint fails at plugin load. `FEEDBACK_ONLY` is unchanged as a mode. Recorded in the [fork-telemetry-default Agent Note](../../.agents/notes/implemented/feature/2026-10-06-fork-telemetry-disabled-default.md), with the registry rows updated from outstanding to applied. Option (c) — pre-upload confirmation — stays available as a later refinement for an operator who wants diagnosable reports and accepts an external receiver.

**9. Which layer owns the pre-migration guard.** A guard at companion boot misses the `dsh` CLI and the Python SDK, which resolve the same `~/.dsh` through `packages/util/home-paths`. Either put the guard in the persistence layer (covers every opener) or accept and document the limitation. Recommendation: persistence layer — the guard's job is to protect the data, not to protect one entry point.
