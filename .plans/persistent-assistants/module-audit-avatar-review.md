# Assistant and standing-team workflow review and repairs

Working tree: `/Users/apple/deepseek-harness`, including existing tracked and untracked implementation. This review repairs the installed user workflows; it does not accept earlier test summaries as current evidence. No commit, merge, or push was performed.

## Repaired findings

| Finding | Repair and regression evidence |
| --- | --- |
| Rebound saved leads exposed another team's activity | The read-only projection verifies the actual non-retired coordinator seat, team, profile and active session before returning data. The independent probe reproduced the leak; permanent controls verify both foreign-team rejection and legitimate roster access. |
| Generated RPC argument counts differed from hand-written Client adapters | Profile updates now supply all three positions; conversation listing, new topics and cancellation supply both positions. Existing team listing retains its explicit archive filter. `remote-arity.spec.ts` checks all 40 mounted calls against Host declarations and rejects invalid profile/cancellation tuples. |
| Blank-team UI creation omitted the coordinator seat | All UI templates, including blank, use `createTeamFromTemplate`. Legacy zero-seat teams receive one coordinator only on explicit provisioning; concurrent requests do not duplicate it. Interrupted repairs bind the existing lead without creating another conversation. |
| Collaboration button called a nonexistent layout method | It opens a shared, dismissible roster modal. Unstarted teams display their saved coordinator profile without inventing a seat/session ID. Opening it neither provisions nor dispatches work. |
| Discussion, tasks and deliverables tabs were placeholders | Explicit discussion submission uses provisioning, durable admission, nonblocking start, committed transcript queries and cancellation. Tasks and completed worker summaries use the real read-only activity projection. Dormant/error states are distinguished from empty successful results. |
| Late navigation/cancellation could leave inconsistent discussion state | Already-admitted work starts once even after navigation; stale reads cannot resurrect an active round after cancellation. Provisioning refreshes the parent directory so bound-team state reaches the roster. |
| Failed forms rejected without useful state recovery | Create/edit, memory operations, route saves and avatar saves report localized errors and preserve drafts or saved values. Missing mutation capabilities reject instead of pretending to save. |
| Stale memory responses and edit revisions crossed local UI lifecycles | Scope switches discard stale reads and drafts. Memory edits retain the revision captured at edit start. |
| Team edits left stale directory data | Successful saves refresh team/seat state before the next edit. Profile and team reads remain independent; a seat query failure does not hide the whole catalog. |
| Clearing a seat model omitted its JSON value | The Client preserves explicit `null`; the Host clears the override and preserves inheritance. Untouched late-arriving model selections are not cleared. |
| Memory promotion searched unrelated teams | The selected team's coordinator profile is the explicit target; rejected promotion remains visible. |
| Child history used an ordinary session address | Team activity navigation uses the actual saved lead as the parent of a child-session address. |
| Failed durable writes leaked effective route state or partial seat edits | Combined seat edits validate before saving. Effective seat/conversation routes change only after successful persistence. Retired seats reject edits. |
| Coordinator changes could leave roster identity inconsistent | Initialized coordinator identities remain unchanged; unsupported changes fail explicitly and the editor explains the restriction. |
| Feature styles used undeclared theme variables | Module styles now reference existing theme tokens. The executed token checker resolves all 158 references. A browser fixture using the actual theme and avatar CSS measured minimum text contrast of 13.21:1 in light mode and 7.77:1 in dark mode. |

## Avatars

Assistants and standing teams support deterministic colored initials and six bundled preset icons. Unknown or historical avatar strings fall back to initials without network requests. Initials preserve Unicode graphemes, including composed emoji. Creation, editing, clearing a preset, lists, home cards, conversation headers, details and collaboration roster surfaces use the shared components.

The existing optional profile field is reused; the team avatar is optional and persists through ordinary/template creation, editing and cold reload. No image service, upload storage or runtime dependency was added. TypeScript is a development-only dependency for the executed RPC declaration audit.

## Verification

- Final feature suite: 60 files, 595 tests passed, exit 0, no unhandled rejections.
- Focused recorded assistant-creation snapshot: 1 passed; 193 other tests excluded by the name filter.
- The initial broad run exposed a fixed-100-ms timing assumption in a conversation test. It was replaced with bounded positive polling, then the full suite passed. Runtime durability ordering was preserved.
- A compiler run exposed an invalid test-only Client subpath import. The fixture now derives the task identifier type from the existing Client projection; the final complete build runs both compiler faces successfully.
- Localization, Client package structure, slot catalog, unknown-cast baseline, export JSDoc and upstream-intake gates pass.
- Cordis catalog: 129 generated files/regions current. Persistence catalog current; 72 roots match 10 history records without pending schema acknowledgements.
- Whitespace and exact trailing-LF checks pass for the two reviewed packages' source, tests and documentation.

The protected upstream source directories have no new handwritten changes. The working tree retains the previously documented generated `packages/core/session/src/known-event-types.ts` addition for `assistant/auxiliary`; literal zero Core-file modifications is therefore not claimed.

## Release verification

Scoped assistant/team repair: verified. The final DMG contains the rebuilt Host scope guard and the completed Client bundle; the complete build was followed by a Host-only rebuild for the final projection guard.

- Artifact: `dist/octopus_DSH.dmg`, 313,344,819 bytes (299 MiB).
- SHA-256: `4a9527a3b98cd60fce14b87c166d8a42c54452278da89a914930a973e3313a9e`.
- Final desktop readiness: 99 checks passed, exit 0. Three added checks reject stale avatar, standing-team workflow and Host repair bundles.
- Final installed acceptance: 86 checks passed, zero failures, exit 0, using the read-only mounted final DMG and isolated fresh/existing profiles. Added checks cover avatar create/update/clear/restart, dormant observation, legacy coordinator repair and foreign-team projection rejection.
- Acceptance verifier controls: 10 passed. The earlier packaged candidate was deliberately tested with the added projection control and rejected for the expected foreign-roster assertion; it was not installed or delivered.
- Installed app: staged from the final DMG on a dedicated mount, signature verified, then replaced with rollback backup under `dist/.cache/module-audit-avatar-backup`. The active desktop Client plugin matches the installed seed.
- Native UI: no assistants boot failure; seven avatar choices displayed; document preset selection read back; the existing unstarted team opened its collaboration modal and displayed its saved coordinator; Escape dismissed the modal. Screenshots were inspected locally without copying user-content screenshots into this report.

The native check submitted no creation/test form. Live interaction during verification changed two avatar fields and added a conversation; these records were retained. The post-check catalog contains two profiles, one team and one conversation, with zero team seats because opening the panel is read-only. Final catalog byte equality is therefore not claimed. The installer itself writes application/plugin/cache files and does not rewrite the user catalog. No live record was deleted or rolled back.

Logs, final artifact identity and aggregate-only catalog observations are under `module-audit-avatar/`.

This is a scoped repair with reproducible controls, not a claim that every possible defect has been eliminated. Windows installation and real paid-provider calls are outside this macOS verification run.

## Separate dependency advisory

The existing `@yejiming/dsh-data-agent@0.2.2` pin includes `js-yaml@4.3.1`. The packaging audit reported one high-severity item; the independently reconstructed installed dependency lock reproduces it (`data-agent-audit.json`, [advisory GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh), CPU exhaustion involving empty YAML merge sources). The npm report identifies 4.3.2 as a patch fix. This third-party data-agent dependency was not changed by the assistant/team repair. No claim of whole-desktop dependency security acceptance is made.
