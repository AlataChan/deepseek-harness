# Skill Evolution Wiki (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `self-evolving-skill` a persistent project wiki, per-skill provenance, one change per run with patching preferred, and a safe default skill root, without adding runtime code.

**Architecture:** WikiSkill's three layers map onto existing storage. The session JSONL log is the raw layer. `<projectRoot>/.dsh/skill-wiki/` is the knowledge layer, which only the distillation procedure reads and which is appended to, never reset. Skill bundles under watched roots are the skill layer, each with a `PURPOSE.md`. All behavior lives in the prompt-only skill; one `skill-filesystem` test pins the discovery rules the layout depends on.

**Tech Stack:** Markdown skill under `.agents/skills`, `@deepseek-ai/dsh-skill-filesystem` Vitest spec, the built `dsh` CLI with the headless profile for a real-API smoke, Agent Note triplet.

**Spec:** Tang et al., *WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution*, arXiv:2608.27454 (untracked local copy at the repository root), and the [2026-09-04 self-evolving-skill Agent Note](../../.agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.md).

## Global Constraints

- No new package, tool, hook, config field, or `SessionEventMap` event; no `agent-loop` change.
- Wiki path is `<projectRoot>/.dsh/skill-wiki/`. It is never placed under `.dsh/skills/`, `.agents/skills/`, `~/.dsh/skills/`, `~/.agents/skills/`, or any `customSkillDirs` entry.
- Discovery rule (`packages/skill/skill-filesystem/src/index.ts:724-728`): a directory entry in a skill root loads only `<dir>/SKILL.md`; a top-level file ending in `.md` loads as a flat skill.
- Default sandbox mode is `workspace-write` (`packages/bundle/base/cordis.patch.yml:217`): fs mutations outside the session workspace and temp roots fail with `FS_SANDBOX_DENIED` until a human approves escalation.
- The model sees no session id, model id, or clock by default (`dsh-time-context` is opt-in). `PURPOSE.md` takes the date from `date +%F` and names the model only when the context states it.
- One physical line per paragraph in `docs/**/*.md` and `.agents/notes/**/*.md` (`verify-md-wrap`).
- Agent Notes ship as an English/Chinese/sidecar triplet recorded with `pnpm run verify-translation-pairing --write <english-path>`.
- Commit messages follow repository history: `<type>(<scope>): <summary>` in English.
- Work on branch `feature/skill-evolution-wiki`.

## Known pre-existing gate failures

`pnpm run verify-translation-pairing` already exits 1 on this checkout: desktop bundle output under `apps/desktop/src-tauri/target/`, several `packages/experimental/*` README pairs, and the English-only `docs/plans/2026-09-04-*.md` plans. This plan is English-only and adds the same finding for its own path until a Chinese counterpart is recorded. Tasks check that the files they change produce no pairing error rather than requiring a clean exit.

## Design decisions

| # | Decision | Source |
|---|---|---|
| 1 | Only the distillation procedure reads the wiki; ordinary task work uses skills | WikiSkill Table 3: task-agent wiki access lowered average accuracy from 63.7% to 60.9% |
| 2 | The wiki is appended to and refined, never reset; declined and reverted proposals keep their full content in `skill-impact.md` | WikiSkill §3.1, §5.3 |
| 3 | One change per run: patch a listed skill, create one skill, or no action; patching preferred | WikiSkill §3.2.3 and Skill Proposer rule 5 (Appendix E.3) |
| 4 | Every distilled skill is a bundle with `PURPOSE.md`: origin, evidence, addressed patterns, scope label, history | WikiSkill §3.1; transfer finding that weak-model workarounds hurt stronger models (Table 2) |
| 5 | New skills default to project-dsh `.dsh/skills/`; `.agents/skills/` and user roots need an explicit user request, otherwise the proposal is recorded as `proposed` | WikiSkill Table 4: about 29% of proposals improved validation; this repository has no validation gate yet |
| 6 | Failure-lesson `description` is one sentence of problem, root cause, and fix | WikiSkill index-quality rule; `tool-skill` shows only the description, capped at 500 characters |
| 7 | Project scope only; no home-directory wiki | Default `workspace-write` sandbox denies writes under `~/.dsh/` |

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | Modify | Pins that bundle siblings and a sibling wiki directory are not skills |
| `.agents/skills/self-evolving-skill/SKILL.md` | Replace | Distillation procedure, wiki layout, provenance, root policy |
| `.agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.md` with `.zh.md` and `.i18n.yaml` | Create | Decision record |
| `.agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.md` with `.zh.md` and `.i18n.yaml` | Modify | Cross-link to the new note |
| `docs/plans/2026-09-13-skill-evolution-wiki.md` | Create | This plan |
| `~/.dsh/skills/self-evolving-skill/SKILL.md` | Refresh, outside the repository | Personal copy loaded outside this checkout |

---

### Task 1: Pin the discovery rules the wiki layout depends on

**Files:**

- Modify: `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts`

**Interfaces:**

- Consumes: the spec's existing helpers `tempDir(name: string): Promise<string>`, `writeSkill(root, name, description, body?): Promise<void>`, and `setupLocal(home: string, config?: Partial<SkillFileSystem.Config>): Promise<Context>`.
- Produces: no symbol; guards the `.dsh/skill-wiki/` and `PURPOSE.md` layout that Task 2 prescribes.

- [ ] **Step 1: Add the test**

Insert inside `describe('FileSystemSkillProvider', ...)`, directly after the test `'discovers symlinked skill directories and flat files'`:

```ts
  it('ignores bundle siblings and a wiki directory beside the skill root', async () => {
    const home = await tempDir('skill-wiki-home')
    const project = await tempDir('skill-wiki-project')
    await mkdir(join(project, '.git'), { recursive: true })
    const skillsRoot = join(project, '.dsh/skills')
    await writeSkill(skillsRoot, 'distilled', 'Distilled skill')
    await writeFile(join(skillsRoot, 'distilled/PURPOSE.md'), '---\nname: purpose\ndescription: Provenance page\n---\n\n## Origin\n')
    const wiki = join(project, '.dsh/skill-wiki')
    await mkdir(join(wiki, 'patterns'), { recursive: true })
    await writeFile(join(wiki, 'index.md'), '---\nname: index\ndescription: Wiki index\n---\n\n- [loop](patterns/loop.md): loop; cause; fix.\n')
    await writeFile(join(wiki, 'patterns/loop.md'), '---\nname: loop\ndescription: Wiki pattern\n---\n\nEvidence.\n')
    const ctx = await setupLocal(home)

    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual(['distilled'])
  })
```

The non-skill files carry valid skill frontmatter on purpose: a discovery change that parsed any Markdown file would register them.

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts -t "bundle siblings"`

Expected: 1 passed. The test describes existing behavior, so it passes before any other change.

- [ ] **Step 3: Prove the assertion rejects a wiki inside a skill root**

Temporarily replace the setup line with `const ctx = await setupLocal(home, { customSkillDirs: [wiki] })` and rerun the Step 2 command.

Expected: FAIL, received `['distilled', 'index']` (the wiki's top-level `index.md` loads as a flat skill).

Restore `const ctx = await setupLocal(home)` and rerun. Expected: 1 passed.

- [ ] **Step 4: Commit**

```sh
git diff --check
git add packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts
git commit -m "test(skill-filesystem): pin that bundle siblings and a sibling wiki are not skills"
```

---

### Task 2: Rewrite the self-evolving-skill procedure

**Files:**

- Replace: `.agents/skills/self-evolving-skill/SKILL.md`

**Interfaces:**

- Consumes: Task 1's pinned discovery rules.
- Produces the on-disk names Task 3 checks: `.dsh/skill-wiki/index.md`, `.dsh/skill-wiki/log.md`, `.dsh/skill-wiki/skill-impact.md`, `.dsh/skill-wiki/patterns/<pattern-name>.md`, bundle file `PURPOSE.md`, `skill-impact.md` entry heading `## <date> <create|patch|no-action> <skill-name>`, and the outcome vocabulary `created | patched | proposed | no-action | declined-by-user | reverted-by-user`.

- [ ] **Step 1: Replace the file with exactly this content**

````markdown
---
name: self-evolving-skill
description: Distill one reusable skill from this session's successful or recovered execution path and record its evidence in the project skill wiki. Use after a non-trivial multi-step task or after recovering from a failure worth avoiding next time.
whenToUse: "After a multi-step task succeeds, or after recovering from a failure that taught a reusable lesson."
---

# Self-Evolving Skill Distillation

Experience is kept in three layers. The session log is the raw record. The project skill wiki at `.dsh/skill-wiki/` keeps what was learned, including proposals that were declined. Skills under a skill root are the instructions future sessions load. A skill can be patched or removed; the wiki is only appended to and refined, never deleted.

## When to distill

Distill when:

- You completed a task of three or more steps that future sessions would repeat.
- You recovered from a failure that future sessions would hit.
- An existing skill was wrong or incomplete for this task.

Do not distill:

- One-off tasks, or one- or two-step tasks already covered by a skill or tool.
- Facts that hold only for this project's specific paths, names, or data. Record them as a wiki pattern (Step 4) instead of a skill.

## Step 1: Read the wiki

If `.dsh/skill-wiki/` exists, read `index.md` and `skill-impact.md` before deciding anything. `skill-impact.md` holds the full content of declined and reverted proposals; do not propose the same change again. Read the pattern pages that match this session's problem.

If the wiki does not exist, create it in Step 4.

## Step 2: Choose one change

Make exactly one change per distillation:

- **Patch** an existing skill when the skill catalog already lists a skill that covers part of this procedure. Prefer this.
- **Create** one new skill only when no listed skill covers the procedure.
- **No action** when a skill already captures the lesson. Still update the wiki in Step 4.

Where the target skill lives decides whether you may write it:

| Root | Path | Rule |
|---|---|---|
| project-dsh | `.dsh/skills/<skill-name>/` | Default for new skills. Write directly. |
| project-agents | `.agents/skills/<skill-name>/` | Committed and shared with every contributor. Write only when the user asks; otherwise record the change in `skill-impact.md` with outcome `proposed` and tell the user. |
| user-dsh, user-agents | `~/.dsh/skills/<skill-name>/`, `~/.agents/skills/<skill-name>/` | Outside the workspace. Write only when the user asks; the default sandbox denies the write until the user approves an escalation. |

Never patch a shared or user skill by writing a same-name copy under `.dsh/skills/`: that root outranks every other skill root, so the copy silently replaces the original.

## Step 3: Write the skill

Always write a directory bundle, never a flat `<skill-name>.md` file:

```
<root>/<skill-name>/SKILL.md
<root>/<skill-name>/PURPOSE.md
```

Only `SKILL.md` loads as a skill; `PURPOSE.md` stays out of the catalog.

`SKILL.md` rules:

- Frontmatter `name` equals the directory name in lower-kebab-case. Quote any `description` or `whenToUse` value that contains a colon.
- `description` is one sentence: what the skill does and when to use it. For a failure lesson, the sentence states the problem, its root cause, and the fix. The catalog shows only this sentence, capped at 500 characters.
- The body is a procedure, not a trace. Good: "Run the build; if error X appears, do Y." Bad: "I ran `pnpm build` at 14:32 and got E1234."
- Replace project-specific paths, names, and ids with descriptions of what they are.
- Write general steps. A workaround for one model's weakness (for example "use only one-line commands") needs a sentence naming the failure it prevents.
- To patch, change only the affected sections with the `edit` tool; rewrite the file only when most of it changes.

`PURPOSE.md` format (create it when patching a skill that has none):

```markdown
# <skill-name>

## Origin
- Date: <output of `date +%F`>
- Task: <one sentence>
- Evidence: <the error message, failing command, or decisive observation, quoted briefly>
- Model: <only when your context states the model; otherwise omit this line>

## Patterns addressed
- `.dsh/skill-wiki/patterns/<pattern-name>.md`

## Scope
general-procedure | model-specific-workaround

## Evolution history
- <date>: created | patched — <what changed and why>
```

When patching, append one `Evolution history` line.

## Step 4: Update the wiki

The wiki lives at `.dsh/skill-wiki/`. Never place it under `.dsh/skills/` or `.agents/skills/`: every top-level `.md` file in a skill root loads as a skill.

```
.dsh/skill-wiki/
  index.md
  log.md
  skill-impact.md
  patterns/<pattern-name>.md
```

- `patterns/<pattern-name>.md`: 10 to 30 lines covering what happens, the root cause (why, not only what), the exact command or action sequence from this session, and the fix. Record successful strategies as patterns too. Add new evidence to an existing page instead of creating a duplicate.
- `index.md`: one line per pattern, `- [<pattern-name>](patterns/<pattern-name>.md): <problem>; <root cause>; <fix>.` Keep it complete.
- `log.md`: append one entry with the date, the task, the patterns created or updated, and the skill change with its outcome.
- `skill-impact.md`: append one entry for this run's change:

```markdown
## <date> <create|patch|no-action> <skill-name>
- Outcome: created | patched | proposed | no-action | declined-by-user | reverted-by-user
- Patterns: <pattern-name>, ...
- Reason: <one sentence>
- Content: <for proposed, declined-by-user, and reverted-by-user only: the full proposed SKILL.md text or edit>
```

When the user declines a proposal, append an entry with outcome `declined-by-user` and the full content. When the user asks to remove a distilled skill, append an entry with outcome `reverted-by-user` and the full content, then delete the bundle. Never delete or rewrite earlier entries.

Only this procedure reads the wiki. Do not consult wiki pages during ordinary task work.

## Step 5: Confirm

Call `skill` with the new or patched skill's name and check that the loaded body matches what you wrote. If it does not load, check that frontmatter `name` matches the directory name, `description` is non-empty, the YAML parses, and the bundle sits directly under a skill root.

## Recalling past sessions (optional)

If the `session_search` tool is available, search earlier sessions for the same failure before choosing a change, and cite matching evidence in the pattern page. Default profiles often omit that tool; distill from the current session when it is absent.
````

- [ ] **Step 2: Check the frontmatter parses**

Run:

```sh
pnpm exec tsx -e "import { readFileSync } from 'node:fs'; import { load } from 'js-yaml'; const lines = readFileSync('.agents/skills/self-evolving-skill/SKILL.md', 'utf8').split('\n'); const end = lines.indexOf('---', 1); console.log(JSON.stringify(load(lines.slice(1, end).join('\n'))))"
```

Expected: one JSON object with exactly the keys `name`, `description`, and `whenToUse`, where `"name":"self-evolving-skill"`.

- [ ] **Step 3: Confirm no recorded snapshot contains this skill**

Run: `grep -rl --exclude-dir=node_modules --exclude-dir=lib "self-evolving-skill" snapshots packages scripts`

Expected: no output, so no snapshot refresh is required.

- [ ] **Step 4: Commit**

```sh
git diff --check
git add .agents/skills/self-evolving-skill/SKILL.md
git commit -m "feat(skill): keep a project skill wiki and provenance in self-evolving-skill"
```

---

### Task 3: Real-API smoke in an isolated project

**Files:** none committed. Evidence goes to `.sisyphus/evidence/skill-wiki-smoke/`.

**Interfaces:**

- Consumes: Task 2's `SKILL.md` and its on-disk names.
- Produces: one `SMOKE_RESULT` line recorded in Task 4.

Prerequisites: `DEEPSEEK_API_KEY` in the repository `.env`; the built CLI at `apps/cli/lib/bin.js` (run `pnpm run build` first when it is missing). Run on macOS, where BSD `wc` pads its output and the seeded script fails. Model runs are nondeterministic; one pass is evidence, not a guarantee. Run Steps 1 to 6 in one shell session.

- [ ] **Step 1: Create the isolated project**

```sh
REPO=/Users/apple/deepseek-harness
SMOKE=$(mktemp -d)
cd "$SMOKE" && git init -q
mkdir -p .agents/skills/self-evolving-skill notes scripts
cp "$REPO/.agents/skills/self-evolving-skill/SKILL.md" .agents/skills/self-evolving-skill/SKILL.md
printf '# A\n\none\ntwo\n' > notes/a.md
printf '# B\n\nthree\n' > notes/b.md
printf '#!/bin/sh\ncat notes/*.md | wc -l\n' > scripts/count-md-lines.sh
set -a; . "$REPO/.env"; set +a
TASK='Make scripts/count-md-lines.sh print exactly 7 with no surrounding whitespace, so that test "$(sh scripts/count-md-lines.sh)" = 7 succeeds. Run the check, fix the script until it passes, then load the self-evolving-skill skill and follow it to distill what you learned.'
```

The project-agents copy (rank 200) shadows the personal copy under `~/.dsh/skills/` (rank 400).

- [ ] **Step 2: Run A, distill from a recovered failure**

```sh
node "$REPO/apps/cli/lib/bin.js" --profile headless "$TASK"
```

- [ ] **Step 3: Check Run A**

```sh
test "$(sh scripts/count-md-lines.sh)" = 7 && echo SCRIPT_OK
test -f .dsh/skill-wiki/index.md && test -f .dsh/skill-wiki/log.md && test -f .dsh/skill-wiki/skill-impact.md && ls .dsh/skill-wiki/patterns/*.md >/dev/null && echo WIKI_OK
test "$(ls -d .dsh/skills/*/ | wc -l | tr -d ' ')" = 1 && ls .dsh/skills/*/SKILL.md .dsh/skills/*/PURPOSE.md >/dev/null && echo BUNDLE_OK
test -z "$(find .dsh/skills -maxdepth 1 -type f -name '*.md')" && echo NO_FLAT_OK
test "$(ls .agents/skills)" = self-evolving-skill && echo SHARED_UNTOUCHED_OK
grep -c '^## ' .dsh/skill-wiki/skill-impact.md
grep 'Outcome: created' .dsh/skill-wiki/skill-impact.md
```

Expected: all five `*_OK` markers print, the entry count is `1`, and the outcome line is `- Outcome: created`.

- [ ] **Step 4: Run B, the distilled skill loads in a new session**

```sh
NAME=$(basename "$(ls -d .dsh/skills/*/)")
node "$REPO/apps/cli/lib/bin.js" --profile headless "Call the skill tool with the name $NAME and reply with the first Markdown heading of its body, nothing else."
grep -m1 '^#' ".dsh/skills/$NAME/SKILL.md"
```

Expected: the reply's heading equals the `grep` output.

- [ ] **Step 5: Run C, one change per run with patching preferred**

```sh
printf '#!/bin/sh\ncat notes/*.md | wc -l\n' > scripts/count-md-lines.sh
node "$REPO/apps/cli/lib/bin.js" --profile headless "$TASK"
test "$(ls -d .dsh/skills/*/ | wc -l | tr -d ' ')" = 1 && echo STILL_ONE_OK
test "$(ls .agents/skills)" = self-evolving-skill && echo SHARED_UNTOUCHED_OK
grep -c '^## ' .dsh/skill-wiki/skill-impact.md
grep -E 'Outcome: (patched|no-action)' .dsh/skill-wiki/skill-impact.md
```

Expected: both `*_OK` markers print, the entry count is `2`, and one outcome line reads `patched` or `no-action`.

- [ ] **Step 6: Record the result and keep evidence**

`SMOKE_RESULT=PASS` when every expectation in Steps 3 to 5 held; otherwise `SMOKE_RESULT=FAIL` naming the first failed check.

```sh
mkdir -p "$REPO/.sisyphus/evidence/skill-wiki-smoke"
cp -R .dsh "$REPO/.sisyphus/evidence/skill-wiki-smoke/"
```

On FAIL, read the newest session log under `~/.dsh/sessions/` to find the step the model skipped, adjust the wording in Task 2, and rerun from Step 1. After three failed attempts, stop and report the failing check and log excerpt.

---

### Task 4: Record the decision

**Files:**

- Create: `.agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.md`
- Create: `.agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.i18n.yaml` (generated)
- Modify: `.agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.md`
- Modify: `.agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.i18n.yaml` (re-recorded)
- Create: `docs/plans/2026-09-13-skill-evolution-wiki.md` (this plan)

**Interfaces:**

- Consumes: Task 3's `SMOKE_RESULT` line.
- Produces: the decision record linked from the 2026-09-04 note.

- [ ] **Step 1: Write the English note**

Replace the last bullet's `<date>` and `<result>` with the Task 3 date and outcome, for example `Live smoke (2026-09-14): SMOKE_RESULT=PASS — Run C patched the Run A skill.`

```markdown
# Agent Note: Skill evolution wiki for self-evolving-skill

Status: implemented

English | [中文](2026-09-13-skill-evolution-wiki.zh.md)

## Problem

`self-evolving-skill` distilled from one session and wrote the result straight into a watched skill root. It kept no record of what was learned, why a skill exists, or which proposals were declined, so later runs could repeat a rejected change and no skill could be traced to its evidence. It also recommended `.agents/skills/` for shared procedures, so a distilled skill reached every contributor without review. WikiSkill (arXiv:2608.27454) measured these gaps: without its persistent wiki, average accuracy fell from 63.7% to 48.7% (Gemini 3.5 Flash); about 29% of skill proposals improved validation scores (Table 4 averages); and letting the task agent read the wiki lowered accuracy to 60.9%. Nine days after the skill shipped, no distilled skill existed in this checkout's `.dsh/skills/` or in the maintainer's `~/.dsh/skills/`.

## Decision

The change stays prompt-only: no package, tool, hook, config field, or session event. The skill keeps a project wiki at `.dsh/skill-wiki/` with `index.md`, `log.md`, `skill-impact.md`, and `patterns/`; only the distillation procedure reads it, and it is appended to, never reset. Each run makes one change and prefers patching a listed skill. Every distilled skill is a bundle whose `PURPOSE.md` records origin, evidence, addressed patterns, scope (`general-procedure` or `model-specific-workaround`), and history. New skills default to `.dsh/skills/`; writes to `.agents/skills/` or user roots need an explicit user request, and otherwise the change is recorded in `skill-impact.md` as `proposed`. Declined and reverted proposals keep their full content there.

The wiki sits beside `.dsh/skills/` because `skill-filesystem` loads every top-level `.md` file in a root as a flat skill and only `SKILL.md` inside a bundle; a `skill-filesystem` test pins both rules. The wiki is project-scoped because the default `workspace-write` sandbox denies fs mutations outside the session workspace.

## Alternatives considered

- **Port the full WikiSkill loop with rollouts, a validation gate, and rollback.** Deferred: it needs labeled train and validation tasks and live rollouts per iteration. The observability plan's `sessionDiagnostics` projection and `evaluation-session-fork` provider supply the failure signal and gate it depends on.
- **Store provenance in frontmatter `metadata`.** Rejected: a malformed YAML value drops the whole skill from the catalog, and a growing multi-line history raises that risk; `PURPOSE.md` is never parsed.
- **Keep a user-scope wiki under `~/.dsh/`.** Rejected: every write would need a sandbox escalation under the default mode.
- **Let the task agent read the wiki.** Rejected: WikiSkill's ablation lowered accuracy when the task agent had wiki access.
- **Keep `.agents/skills/` as the default for shared procedures.** Rejected: without a validation gate, an explicit user request is the only review before a skill reaches every contributor.

## Consequences

- Distilled skills stay local to one checkout until the user asks to share them.
- `skill-impact.md` is the record a future evaluation gate appends measured outcomes to.
- The wiki has no pruning; revisit when `index.md` no longer fits in one read.
- Personal copies of the skill under `~/.dsh/skills/` are refreshed by hand.
- Live smoke (<date>): <result>.
```

- [ ] **Step 2: Write the Chinese counterpart**

Create `2026-09-13-skill-evolution-wiki.zh.md` with the same headings, bullets, and links in the same order. Copy the language-switcher line format from `2026-09-04-self-evolving-skill-project-agents.zh.md`. Use `docs/i18n/terminology.md` for term choices.

- [ ] **Step 3: Cross-link the 2026-09-04 note**

Append to `## Consequences` in `2026-09-04-self-evolving-skill-project-agents.md`:

```markdown
- Extended by the [skill evolution wiki](2026-09-13-skill-evolution-wiki.md): distilled skills default to `.dsh/skills/`, carry `PURPOSE.md`, and record evidence in `.dsh/skill-wiki/`.
```

Append the matching bullet, linking `2026-09-13-skill-evolution-wiki.zh.md`, to the same section of the `.zh.md` file.

- [ ] **Step 4: Record both pairs**

```sh
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.md
pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.md
```

- [ ] **Step 5: Run the documentation gates**

```sh
pnpm run verify-agent-note-format
pnpm run -s verify-md-wrap 2>&1 | grep -E '2026-09-13-skill-evolution-wiki|2026-09-04-self-evolving-skill-project-agents'
pnpm run -s verify-md-links 2>&1 | grep -E '2026-09-13-skill-evolution-wiki|2026-09-04-self-evolving-skill-project-agents'
pnpm run -s verify-translation-pairing 2>&1 | grep -E '\.agents/notes/implemented/feature/2026-09-(13-skill-evolution-wiki|04-self-evolving-skill-project-agents)'
git diff --check
```

Expected: `verify-agent-note-format` passes; each `grep` prints nothing; `git diff --check` prints nothing.

- [ ] **Step 6: Commit**

```sh
git add .agents/notes/implemented/feature/2026-09-13-skill-evolution-wiki.* .agents/notes/implemented/feature/2026-09-04-self-evolving-skill-project-agents.* docs/plans/2026-09-13-skill-evolution-wiki.md
git commit -m "docs(skill): record the skill evolution wiki decision"
```

---

### Task 5: Refresh the personal skill copy

**Files:** `~/.dsh/skills/self-evolving-skill/SKILL.md`, outside the repository. On 2026-09-13 it was identical to the pre-Task-2 repository version, and sessions outside this checkout load it.

- [ ] **Step 1: Copy and verify**

```sh
cp /Users/apple/deepseek-harness/.agents/skills/self-evolving-skill/SKILL.md ~/.dsh/skills/self-evolving-skill/SKILL.md
diff ~/.dsh/skills/self-evolving-skill/SKILL.md /Users/apple/deepseek-harness/.agents/skills/self-evolving-skill/SKILL.md && echo IDENTICAL
```

Expected: `IDENTICAL`. No commit.

---

## Later phases (separate plans)

**P1: cross-session consolidation.** Entry condition: the `sessionDiagnostics` projection ships (observability plan Phase 1, Tasks 2 and 3). Scope: an offline headless or `workflow` run picks sessions by diagnostic findings (up to 5 with findings and up to 3 clean completions, matching WikiSkill's sampling), reads them through `session_search`, and updates `.dsh/skill-wiki/` without changing skills.

**P2: validation gate.** Entry condition: `evaluation-session-fork` ships (observability plan Phase 4, Tasks 10 and 11). Scope: candidates are presets that differ only in their skill set; forks start at recorded prompt sequence numbers; world verification scores the results; the evaluation run, not the model, appends each outcome to `skill-impact.md`; a human applies accepted skills. Recorded-session snapshots replay model output and cannot evaluate a skill change, so this gate spends live tokens. Pilot domain: desktop ask-data, whose answers are checkable against the bound SQLite database. WikiSkill's validation splits held 10 to 40 tasks, so acceptance requires the evaluation report's confidence interval or its explicit insufficient-sample result.
