---
name: self-evolving-skill
description: Distill reusable skills from the current session's successful or failed execution paths. Use after completing a non-trivial multi-step task or after recovering from a failure, when the execution pattern is worth reusing.
whenToUse: After a multi-step task completes successfully, or after recovering from a failure that taught a reusable lesson.
---

# Self-Evolving Skill Distillation

## When to distill

Distill a skill when:
- You completed a 3+ step task that future sessions would repeat (deploy, build, debug a specific subsystem).
- You recovered from a failure that future sessions would hit (a known pitfall, a misleading error).
- You built a reusable procedure that doesn't already exist as a skill.

Do NOT distill:
- One-off tasks that won't recur.
- Trivial 1-2 step tasks already covered by existing skills or tools.
- Tasks where the current session's specifics (paths, names) are the only value — generalize first or skip.

## How to distill

1. Review your own conversation in this session. Identify the successful execution path (skip dead ends and retries unless the dead end itself is the lesson).

2. Generalize: replace project-specific paths, names, and ids with variables or descriptions of what they represent. A skill that only works for one project is a note, not a skill.

3. Write the skill body as a procedure, not a trace:
   - Good: "Run the build, then check output for errors. If error X, do Y."
   - Bad: "I ran `pnpm build` at 14:32, got error E1234, then ran `pnpm fix`..."

4. Write a clear `description` in the frontmatter — it's what the catalog shows and what decides whether the skill is loaded. One sentence: what it does + when to use it.

## Where to write

Use the `write` tool to create the skill file. There are four watched roots at different ranks; pick the scope that matches the skill's audience:

| Root | Rank | Path | Scope |
|---|---|---|---|
| project-dsh | 100 | `<projectRoot>/.dsh/skills/<skill-name>/SKILL.md` | Repo-scoped, dsh-native |
| project-agents | 200 | `<projectRoot>/.agents/skills/<skill-name>/SKILL.md` | Repo-scoped, agents-compatible |
| user-dsh | 400 | `~/.dsh/skills/<skill-name>/SKILL.md` | Personal, dsh-native, across all projects |
| user-agents | 500 | `~/.agents/skills/<skill-name>/SKILL.md` | Personal, agents-compatible, across all projects |

`.dsh/skills/` (ranks 100/400) and `.agents/skills/` (ranks 200/500) are two different roots at different ranks — they are not synonyms. A skill in a lower-rank root shadows the same name in a higher-rank root within the same scope. Both are watched and hot-reloaded.

Use lower-kebab-case for `<skill-name>`. The `write` tool's hot-reload makes the skill available immediately — no restart needed.

For fork-shared procedures that every contributor should see, prefer `project-agents` (this repository's `.agents/skills/`). For personal experiments, prefer `user-dsh`.

## Frontmatter format

```yaml
---
name: <skill-name>  # must match the directory name, lower-kebab-case
description: <one sentence: what + when>
whenToUse: <optional: trigger scenario>
---
```

After the frontmatter, write the procedure in Markdown. Keep it under 500 lines — long skills are harder to load and harder to keep current.

## After writing

Confirm the skill loaded by calling `skill` with its name. If it doesn't appear, check:
- Frontmatter `name` matches the directory name.
- `description` is non-empty.
- The file is under a watched root (`.dsh/skills/` or `.agents/skills/`).

## Recalling past sessions (optional)

If the composition mounts `session_search`, you may search prior sessions for similar work before distilling. Default shipped profiles often omit that tool — do not block distillation on it. Prefer the current conversation when recall is unavailable.

## Failure lessons

If you learned from a failure (not a success), still distill it as a skill, but frame the body as "avoid X" or "when you see error Y, do Z" — a failure lesson is a skill whose `whenToUse` is the error symptom.
