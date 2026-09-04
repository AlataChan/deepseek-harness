# Agent Note: Ship WeChat article extractor skill with soft rate limits

Status: implemented

English | [中文](2026-09-04-wechat-article-extractor-skill.zh.md)

## Problem

The fork already used a personal `~/.agents/skills/wechat-article-extractor` skill to read WeChat Official Account articles, but it was not in the repository, not shipped in octopus_DSH, and had no proactive guard against mass URL fetches that trigger platform error 1004.

## Decision

1. Commit the skill under `.agents/skills/wechat-article-extractor/` (project-agents) with Chinese-first `SKILL.md` guidance.
2. Add a local soft rate limit in `scripts/rate-limit.js` (loose defaults: 8 URL fetches per hour, 20s minimum interval, 15-minute cooldown after 1004) and wrap URL extraction in `extract.js`.
3. Ship the skill in the DMG via `Resources/resources/bundled-skills/`, prepared by `scripts/seed-desktop-bundled-skills.mjs` and pinned in `scripts/desktop-bundled-skills.json`. On launch, `install_bundled_skills` copies into `~/.dsh/skills/` (user-dsh) while preserving `.rate-limit-state.json`.

## Alternatives considered

- **Prompt-only limits.** Rejected as sole control: the model can still burst requests.
- **New Cordis tool package.** Rejected for v1: the existing skill script already works; a Host tool would be a larger product change.
- **Seed only into the git checkout `.agents/skills`.** Insufficient for desktop users whose workspace is not this repository.

## Consequences

- Repo contributors see the skill when the workspace is this fork; desktop users get it under `~/.dsh/skills` after installing a DMG that embeds `bundled-skills`.
- Local counters live beside the skill and survive refreshes; `node_modules` is installed at DMG pack time, not committed.
- Mass scraping remains discouraged; the gate is soft and local, not a WeChat API contract.
