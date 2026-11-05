# Cursor A4.6 refresh and precedence review (task_5d117d405325, dispatch ctx_eeabe3008721)

Reviewer: Cursor (independent; read-only except this file). Under review: the uncommitted A4.6 diff in `apps/desktop/src-tauri/src/app.rs` and `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts`, against `docs/plans/2026-11-03-octopus-stage-a-native-teamwork-plan.md` Task A4 item 6, `.plans/octopus-implementation/stage-a/a4.6-a6-preparation.md` §1, and `.plans/octopus-implementation/stage-a/refresh-and-precedence.md`. Baseline HEAD `e800c8261bf52eefc5680d51b23939d72ad92ff1`. Nothing committed.

## Verdict

**ACCEPT the A4.6 startup-refresh and project-precedence proof. Score 9/10.** No Required finding. The production edit is the approved testability extraction: `install_bundled_skills_in` keeps the previous seed algorithm, and the wrapper still resolves `resource_dir`, `resources/bundled-skills`, and `dsh_home().join("skills")`. Both new tests call the real private helper and the real `FileSystemSkillProvider` plus `SkillRegistry` on private temp roots. A6 installer qualification stays open. This source and test review does not accept an installed app, a DMG, or a restart/refresh in a test home.

| Axis | Score | Reason |
| --- | --- | --- |
| Correctness | 9 | Helper body differs from HEAD only by `&Path` reference adjustments. Mutation order is unchanged. Tests lock recursive recopy, delete-and-recopy, stamp skip, revision reseed, rate-limit bytes, user-skill survival, and project-agents > user-dsh > bundled. |
| Simplicity | 9 | One private helper, a six-line wrapper, and one new test in each existing harness. |
| Security | 9 | Tests use private temp roots. The seeder still deletes only bundled skill names and restores only `.rate-limit-state.json`. Symlink stamp refusal is untouched. |
| Conformance | 9 | Matches A4 item 6: refresh and precedence are tested separately, and delete-and-recopy, stamp policy, and ranks are unchanged. The plan's "inspect app.rs" line is met by the coordinator-approved extraction. A6 stays open. |

## Required

None.

## Suggested

- **S1 — Absent and second-refresh oracles can be tighter.** After the missing-root call, the test checks `SeedOutcome::Absent` and that the stamp is still `OTHER_REVISION` (`app.rs:1602-1607`). It does not re-read `team-orchestration/SKILL.md` or `my-own-skill/SKILL.md`. `my-own-skill` is asserted after the first reseed (`:1567`) and not after the `OTHER_REVISION` reseed. The helper returns before any write on a missing source, and the reseed loop only visits payload names, so the current assertions plus the source are enough to accept. A later edit could add those two reads.
- **S2 — `SeedOutcome::Failed` stays source-reviewed.** A failed `copy_dir_recursive` sets `failed`, skips rate-limit restore for that skill, and returns before `write_stamp` (`app.rs:919-929`). That order matches HEAD. The new test covers success, skip, reseed, and absent source only.
- **S3 — Bundled winner is list-only.** The bare-home case asserts `source: 'bundled'` and description `Bundled 0.1.0` (`skill-filesystem.spec.ts:265-266`). It does not call `get()`. Project and user-dsh both call `get()`.
- **S4 — Reference bytes are read from the winning directory with `node:fs`.** `get()` returns `content: 'Project body.'` and `resourceBase: { kind: 'directory', path: projectSkill }`, then `readFile` loads `references/task-spec.md` and `references/recovery.md` from that path (`skill-filesystem.spec.ts:248-254`). That pins the project base and the project reference bodies. It does not go through `ctx.fs.readText`. Installed discovery remains an A6 obligation.
- **S5 — Test-helper comment overclaims the marker.** `write_bundled_team_skill` says the marker is baked into every file (`app.rs:1479-1482`). `package.json` is a fixed string (`:1492-1496`). `SKILL.md`, `task-spec.md`, and `recovery.md` carry the marker.

## Extraction evidence

`git diff HEAD` for the two scoped files is `2 files changed, 193 insertions(+), 7 deletions(-)`. A body diff of `install_bundled_skills` at HEAD `app.rs:873-929` against `install_bundled_skills_in` at `app.rs:884-935` shows only these edits:

- `resource_dir` resolution and `resource.join("resources").join("bundled-skills")` moved to the wrapper (`app.rs:871-876`). `resource_dir` failure still returns `SeedOutcome::Absent` before `dsh_home()` runs.
- `read_dir(&src_root)` became `read_dir(src_root)` because the parameter is `&Path`.
- `let dest_root = dsh_home().join("skills")` moved to the wrapper argument `dsh_home().join("skills")`.
- `bundled_skills_seeded(&dest_root, …)` and `create_dir_all(&dest_root)` dropped one `&` because `dest_root` is already `&Path`.

The collect filter, `bundled_skills_seeded` skip, per-skill rate-limit read, `remove_dir_all`, `copy_dir_recursive`, rate-limit restore, `Failed` return, `create_dir_all`, and `write_stamp` sequence has no textual change. `copy_dir_recursive` (`app.rs:959-972`) and `bundled_skills_seeded` (`app.rs:629-637`) are outside the diff. The production call at `app.rs:994` still passes `seed_revision.as_deref()` into `install_bundled_skills`. `packages/skill/skill-filesystem/src` and `apps/desktop/src-tauri/src/lib.rs` have an empty diff against HEAD.

`dsh_home()` (`app.rs:171-181`) reads `DSH_HOME`, otherwise `HOME` or `USERPROFILE` joined with `.dsh`, otherwise `./.dsh`. It creates nothing. The wrapper evaluates it before the helper's `is_dir` / `read_dir` absent returns, while HEAD evaluated it after the skill list was collected. On those absent paths the returned `SeedOutcome` and the filesystem are unchanged, because the path is unused until a seed proceeds. This is an inert scheduling difference, recorded here so the ordering claim stays exact.

## Refresh test evidence

`app::tests::bundled_skills_refresh_recopies_recursively_and_preserves_user_skill_and_rate_limit` (`app.rs:1512-1608`) is inside `#[cfg(test)] mod tests`, which does `use super::*`, and it calls `install_bundled_skills_in` directly. `tempfile::tempdir` owns both roots. The fixture writes `team-orchestration/{SKILL.md,package.json,references/task-spec.md,references/recovery.md}`, `wechat-article-extractor/{SKILL.md,scripts/rate-limit.js}`, a source directory `not-a-skill` without `SKILL.md`, dest `my-own-skill/SKILL.md`, a stale team tree including `stale-note.md`, and dest `wechat-article-extractor/.rate-limit-state.json` containing `{"count": 3}`.

Asserted outcomes, in order:

- First call with `REVISION` returns `Reseeded`. Team `SKILL.md` contains `description: 0.1.0`, `package.json` is a file, and both reference files equal the `0.1.0` payload. `stale-note.md` is gone. `not-a-skill` is absent. The rate-limit file is still `{"count": 3}\n`. `my-own-skill/SKILL.md` is still `# my own skill\n`. The stamp matches `REVISION`.
- Rewriting the payload to `0.2.0` and calling again with `REVISION` returns `Skipped`, and team `SKILL.md` still contains `0.1.0`.
- Calling with `OTHER_REVISION` returns `Reseeded`. Team `SKILL.md` contains `0.2.0`, `references/task-spec.md` is `# task spec 0.2.0\n`, the rate-limit file is still `{"count": 3}\n`, and the stamp matches `OTHER_REVISION`.
- A missing source root returns `Absent`, and the stamp is still `OTHER_REVISION`.

`REVISION` and `OTHER_REVISION` are the existing 64-character lowercase hex fixtures (`app.rs:1023-1024`). `write_stamp` stores `{revision}\n` (`app.rs:450`) and `stamp_matches` compares the trimmed file (`app.rs:429-436`). There is no content hash in the skip decision: same revision plus present `SKILL.md` files skips even when the payload changed, which is the policy A4 item 6 says to keep.

## Precedence test evidence

`shadows seeded bundled and home skill copies with project-local precedence without changing policy` (`skill-filesystem.spec.ts:221-267`) uses `tempDir`, which `mkdtemp`s under `os.tmpdir()` and `realpath`s the result (`:16-19`). `setupLocal` (`:154-163`) loads the real `SkillRegistry` and the real `skill-filesystem` plugin with `dshHome: join(home, '.dsh')`, `agentsHome: join(home, '.agents')`, `watch: false`, and the test's `bundledSkillDir`. No list/get fake is installed.

Ranks in the provider are unchanged by this diff: `PROJECT_DSH_RANK` 100, `PROJECT_AGENTS_RANK` 200, `CUSTOM_RANK` 300, `USER_DSH_RANK` 400, `USER_AGENTS_RANK` 500 (`packages/skill/skill-filesystem/src/index.ts:36-40`), `BUNDLED_SKILL_RANK` 600 (`packages/skill/skill/src/index.ts:28`). `roots()` pushes project-dsh, project-agents, custom, user-dsh, user-agents, then bundled (`skill-filesystem/src/index.ts:245-263`). Within one registry layer, candidates sort by ascending rank and the first name wins (`packages/skill/skill/src/index.ts:567-578`). `ctx.skills.get` loads that winner (`:500-508`). The filesystem provider sets `resourceBase` to `{ kind: 'directory', path: locator.directory }` (`skill-filesystem/src/index.ts:214-221`).

The fixture places the same skill name in three roots: `home/.dsh/skills/team-orchestration` (seeded body), the bundled temp root (`Bundled body.`), and `project/.agents/skills/team-orchestration` with `references/task-spec.md` and `references/recovery.md`. `project` contains `.git`, so `findProjectRoot` (`skill-filesystem/src/index.ts:945-954`) stops there. Asserted results:

- `list({ cwd: project })` winner is `source: 'project-agents'`, description `Project-local 0.2.0`.
- `get('team-orchestration', { cwd: project })` content is `Project body.` and `resourceBase.path` is the project skill directory. Both reference reads return the project bodies.
- `list`/`get` with `cwd` of an empty temp directory return `source: 'user-dsh'` and `Seeded body.`, so the seeded home copy beats the bundled root when the project has no local copy.
- A second provider whose home has no seeded copy lists `source: 'bundled'`, description `Bundled 0.1.0`.

The spec diff is additive. Existing precedence coverage in the same file is unchanged.

## Execution evidence used

This review did not re-run the tests. Coordinator message `msg_a48897caa3dd` (acked `delivery_9d198f6a30a7`) says root already passed the two new tests and asked for source and regression review.

| Evidence | Result |
| --- | --- |
| `.plans/octopus-implementation/orchestration/root-a4-refresh-native-check.log` | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib app::tests::bundled_skills_refresh_recopies_recursively_and_preserves_user_skill_and_rate_limit` — 1 passed, 43 filtered, 0 failed |
| `.plans/octopus-implementation/orchestration/root-a4-project-precedence-check.log` | `pnpm exec vitest run packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts -t 'shadows seeded bundled and home skill copies'` — 1 passed, 22 skipped, 23 total, exit recorded by root as 0 |
| `.plans/octopus-implementation/stage-a/refresh-and-precedence.md` §3 | Implementer report: full file vitest 23 passed; `cargo test --lib` 44 passed; `cargo test --lib app::tests` 10 passed. Those full-suite counts were not re-executed here. |

Commands this reviewer did run: `git diff` on the two files, a body diff of the old function against `install_bundled_skills_in`, `git diff --stat` on `packages/skill/skill-filesystem/src` and `apps/desktop/src-tauri/src/lib.rs` (empty), and `shasum -a 256` of the two reviewed files. No production edit, commit, push, installer, API call, or recording.

## Hashes

Working-tree SHA-256 at review time:

| File | SHA-256 |
| --- | --- |
| `apps/desktop/src-tauri/src/app.rs` | `c91fe3273b5f62382b1fc3af95900fbd663b9b57cfcaabf0bcc4779894f02415` |
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | `db1fd575c97120a471c52e9eb5603c496624da81f51c08bde7d30549e317a922` |

## Limits

A6 remains exactly the installed-flow obligation in `refresh-and-precedence.md` §4 and plan Task A6: built `dist/octopus_DSH.dmg`, bundle verifier, fresh test home, installed discovery and reference reads, collaboration example, ordinary-chat control, standing squad, restart inspection, reinstall/refresh of references beside unrelated user skills, and effective model selections. The wrapper's `AppHandle::path().resource_dir()` branch is source-reviewed and not executed, because the test calls the extracted helper. The worktree contains other dirty files outside this diff; this review did not modify them.
