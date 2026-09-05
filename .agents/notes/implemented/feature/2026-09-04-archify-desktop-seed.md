# Agent Note: Archify desktop bundled-skill seed

Status: implemented

English | [中文](2026-09-04-archify-desktop-seed.zh.md)

## Problem

Desktop users need Archify without a manual `dsh plugin add`, but `@tt-a1i/archify-dsh` is skill-only and fails the web `dsh.client` profile-plugin seed validator.

## Decision

Ship the Archify skill to octopus_DSH desktop users by default through `Resources/resources/bundled-skills/` → `~/.dsh/skills/archify`, not through `desktop-profile-plugins.json`. Pin `{ name: "archify", source: "npm", package: "@tt-a1i/archify-dsh", version: "0.1.0", skillSubpath: "skills/archify" }` in `scripts/desktop-bundled-skills.json`. Live collaboration remains the Client Team dock; Archify stays post-hoc.

## Alternatives considered

- **Profile-plugin pin.** Rejected: `validatePluginDir` requires `dsh.client.platform === 'web'`.
- **Keep Archify opt-in only.** Rejected for this fork: distributed users would never see the skill.

## Verification

```bash
node scripts/seed-desktop-bundled-skills.mjs --out /tmp/dsh-bundled-skills-test
test -f /tmp/dsh-bundled-skills-test/archify/SKILL.md
```
