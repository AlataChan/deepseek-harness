# Cursor Stage A final delta review (task_5560bb825f62, dispatch ctx_71838cdf11de)

Reviewer: Cursor (independent; read-only except this file). Under review: OpenCode N1 round task_1e40925dd44a (dispatch ctx_ac16790bf0e1), reported in `opencode-stage-a-n1-report.md`, against `cursor-stage-a-rereview.md`. Baseline HEAD `e800c8261b`; nothing committed. Delta scope only: R1–R3 and the duplicate-name fix were already cleared and are not re-reviewed.

## Verdict

**ACCEPT, bounded A2/A4/A5 source only. Score 9/10.** N1 is fixed with wording that matches the real home-card flow and makes no repair promise. W1 and W2 now use meaningful assertions, and mutation probes show each one fails when its fix is reverted. The W3 correction is accurate. No new Required finding. This is not acceptance of full Stage A: A3 paid recordings, the A4.6 startup-refresh proof, and A6 installer proof remain open.

| Axis | Score | Reason |
| --- | --- | --- |
| Correctness | 9 | Fallback matches `ensureInstitutionSquad` and the home card; one status literal (`interrupted`) does not exist (W4, non-blocking). |
| Simplicity | 9 | Three-file wording and assertion edits; no new mechanism. |
| Security | 9 | Unchanged from the re-review; the new `existsSync(out)` assertions pin "no write before rejection". |
| Conformance | 9 | Edits stay within the three authorized files; references, helper, seeder, validator, and runtime packages are untouched. |

## Delta scope check

- After the re-review (23:13), only `.agents/skills/team-orchestration/SKILL.md` (23:15:35), `scripts/seed-desktop-bundled-skills.spec.ts` (23:15:45), and `scripts/team-orchestration-skill.spec.ts` (23:16:07) changed. `references/*.md`, `bundled-skill-files.mjs`, `seed-desktop-bundled-skills.mjs`, and `verify-desktop-bundled-skills.mjs` all predate the re-review.
- `git diff HEAD --stat` on `agent-team`, `tool-agent-team`, `client-ui-agent-team`, `apps/desktop/src-tauri`, and `packages/bundle/desktop-app` is empty.
- `opencode-stage-a-fix-report.md` was last modified at 22:53, so the frozen prior report was not edited.

## Dispositions

### N1 — standing-squad fallback — RESOLVED

`SKILL.md:12` now says that a missing seat, or a seat in an abnormal state, means this session's standing setup is incomplete or was interrupted. The Lead quotes the `list_agents` status and diagnostics to the user as-is and points the user to 「首页「机构常驻小队」卡片」 to re-enter or adjust seat models. The text says re-entry does not guarantee that a failed seat is repaired, and it keeps 「不用 `spawn_teammate` 顶替席位」.

Source checks:
- **Real routing.** The home card's `dispatch` (`client-ui-agent-team/src/client/InstitutionSquads.tsx:139-161`) reuses `row.leadSessionId` and calls `ensure(sessionId, { squadId })`, which is wired to `teams.ensureInstitutionSquad` (`mount.ts:113`). The seat `<select>` (`InstitutionSquads.tsx:242`) calls `updateSeat` → `teams.updateInstitutionSeat` (`mount.ts:109`). Both actions described in the skill exist on that card.
- **Provisioning uncertainty.** `ensureInstitutionSquad` (`agent-team/src/index.ts:543-550`) skips every seat name already on the roster. Re-entry therefore spawns missing seats, but it does not respawn a `failed` seat, because the failed name is still on the roster. The skill's "不保证 failed 的座位会被自动修复" is accurate, and it promises no repair.
- **Diagnostics exist.** `roster.ts:148-157` projects `status: 'failed'` and `diagnostics: [member.error]` for failed seats, so "转述状态和诊断信息" refers to real fields.
- No seat-configuration tool is implied. The fallback points the user at the home card, not the model, and the "由 Host 管理" sentence still states that the model does not change seat configuration.

Suggestion accepted in the same pass: 「(默认为 `spawn`/`fork`)」 matches the configurable `freshProvider`/`forkProvider` defaults.

### W1 — vacuous seeder duplicate assertion — RESOLVED

`seed-desktop-bundled-skills.spec.ts:351` (duplicate) and `:336` (bad name) now assert `expect(existsSync(out)).toBe(false)`. `out` is `join(tempDir(...), 'bundled-skills')` and does not exist beforehand, and the seeder runs `rmSync`/`mkdirSync(out)` at `seed-desktop-bundled-skills.mjs:169-170`, right after `loadSkillPin`. So the assertion pins "rejected before any filesystem write". The mutation probe below confirms it: with either check disabled, the seeder still exits 1 but creates `out`. In that case the new assertion catches the regression and the status assertion alone does not.

### W2 — vacuous negative route assertion — RESOLVED

The vacuous `not.toContain('以 \`provider\`/\`model\`')` loop has been removed, and the four positive R1 phrases remain (`team-orchestration-skill.spec.ts:125-131`). The new test (`:133-142`) pins the home-card phrase, the as-is diagnostics relay, the no-auto-repair sentence, and the `spawn_teammate` ban. It also checks that none of the four skill files contains 「Host 设置」. Probe: with the original N1 sentence restored, three of the four positives and the negative fail. The `spawn_teammate` ban passes either way, as intended, because that sentence was already in the original text.

### W3 — S11 deferral rationale — RESOLVED (report-only)

The corrected statement in the N1 report matches the re-review. The EXE spec does not pin validator invocation, both verifier call sites were confirmed only by reading source, and installer-level proof is deferred to A6.

## New findings

No new Required finding.

- **W4 (warning, non-blocking): `interrupted` is not a `list_agents` status.** `SKILL.md:12` says 「某个座位显示 failed/interrupted 等异常状态」. `TeamMemberView.status` is only `running | inactive | provisioning | failed` (`agent-team/src/types.ts:73`). The coordinator raised the same wording, and I assessed it against the source. Interrupted seat provisioning is reconciled to `status: 'failed'` with diagnostic text such as "provisioning did not leave a resumable child Session" or "child Session recovery failed: …" (`roster.ts:397-431`), so "interrupted" names a real cause that the model sees in `diagnostics`, not in `status`. A teammate stopped by `interrupt_agent` appears as `inactive` and recovers through `send_message` (`references/recovery.md:14`), not through re-entry. The fallback's real trigger, a missing seat or a `failed` status, is stated correctly, and the 「等」 hedge keeps `interrupted` an example rather than a status the model must match. A model that reads `inactive` as "interrupted" would send the user to re-enter unnecessarily; that is harmless, and re-entry is a no-op for seats already on the roster. So this does not block source acceptance. Suggested wording: 「某个座位 `status` 为 `failed`（原因见 `diagnostics`）」, and remove `interrupted`.
- **Suggestion:** a seat-model change through `updateSeat` only updates the catalog binding. It takes effect only for seats that the next `ensureInstitutionSquad` actually spawns, which excludes seats already on the roster. The no-repair caveat already covers the user-facing result; a future revision could tie it to both actions instead of only to 「重新进入」.

## Commands run by this reviewer

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm exec vitest run scripts/seed-desktop-bundled-skills.spec.ts scripts/team-orchestration-skill.spec.ts` | 0 | 2 files, 39 tests passed |
| `pnpm exec tsx scripts/run-oxlint.ts scripts/seed-desktop-bundled-skills.spec.ts scripts/team-orchestration-skill.spec.ts` | 0 | clean |
| Seeder mutation probe (temp copies of seeder and helper; `sed` only in the temp dir; output dir `<tmp>/o/bundled-skills`) | — | real/badname exit 1, out absent; real/dup exit 1, out absent; name-check disabled + badname exit 1, **out created**; dup-check disabled + dup exit 1, **out created**; temp dir removed |
| N1 text-revert probe (in-memory: current `SKILL.md` versus the same text with the original "请在 Host 设置里完成配置" sentence restored) | — | current: 4/4 positives, no 「Host 设置」; reverted: positives `[F, F, F, T]`, 「Host 设置」 present |
| `stat` mtimes on Stage A files and the prior reports; `git diff HEAD --stat` on runtime, client, official desktop, and companion packages | — | only the three authorized files changed after the re-review; runtime diff empty |

Not rerun, because their inputs are unchanged: `tsc -p tsconfig.host.json` (the spec edits add only string assertions and an already-imported `existsSync`), `verify-desktop-exe.spec.ts`, builds, `test:docs`/`doc-sync`, and `verify-upstream-intake`. The re-review's 45-test, typecheck, and build evidence applies only to the revision it was run against. No installers, platform runs, keys, or paid calls were used.

## Open gates, separate from this source verdict

- **A3 pending:** no `snapshots/session/team-orchestration*` recordings and no paid-recording authorization; standing-squad headless feasibility is unproven.
- **A4.6 partially open:** the `install_bundled_skills` recursive copy, startup refresh, and user-skill preservation are confirmed only by reading source.
- **A6 pending:** no DMG/EXE built; installed discovery, restart/refresh, effective-model inspection, and the S10/S11 validator-invocation proof remain unqualified.

Root holds final acceptance. This ACCEPT covers only the bounded A2/A4/A5 source delta, not full Stage A.
