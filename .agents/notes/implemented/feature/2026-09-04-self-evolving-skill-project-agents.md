# Agent Note: Ship self-evolving-skill into project-agents

Status: implemented

English | [中文](2026-09-04-self-evolving-skill-project-agents.zh.md)

## Problem

The revised Agent Self-Evolution plan lived as a Sisyphus design and a user-local `~/.dsh/skills/self-evolving-skill/SKILL.md` copy. Fork contributors and octopus_DSH checkouts did not receive the skill, frontmatter lacked `whenToUse`, and the plan overstated default access to `session_search`.

## Decision

Commit the prompt-only skill at `.agents/skills/self-evolving-skill/SKILL.md` (project-agents, rank 200) with `whenToUse`, and document that `session_search` is optional when the composition mounts `tool-session-query`. Keep zero new packages and no promote/distill tools. Update `.sisyphus/plans/agent-self-evolution.md` to record this placement.

## Alternatives considered

- **Keep user-dsh only.** Rejected: personal install is not reproducible for the fork.
- **Mount `tool-session-query` in default desktop/headless.** Deferred: out of scope for landing the skill; the skill must not require that tool.
- **Add `validate_skill` / Stop hook.** Deferred until observed pain, per the revised plan.

## Consequences

- Contributors cloning this fork see the skill under project-agents without a manual home install.
- Default profiles without `session_search` can still distill from the current conversation.
- §4.2 live smoke (2026-09-04): isolated temp project + headless profile returned `SMOKE_RESULT=PASS` — multi-step greet script, distill via `self-evolving-skill`/`write` to `.dsh/skills/smoke-greet-distill/SKILL.md`, then `skill` load confirmed. One frontmatter YAML quote issue on `whenToUse` was self-corrected by the model before registration succeeded.
