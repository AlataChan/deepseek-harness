# Agent Note: Ship Agent Team into octopus_DSH desktop profile plugins

Status: implemented

English | [中文](2026-09-03-agent-team-desktop-profile-plugin.zh.md)

## Problem

Agent Team lived only under `packages/experimental/` and the headless/Web profile overlays. octopus_DSH DMG seeding reads [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) and requires each pin to be a dual-face package (`dsh.bundle.patch` + `dsh.client` + `./client` on disk). `agent-team-profile` and `agent-team-web-profile` are Host-only patch bundles, so they fail seed validation and were never copied into `Resources/resources/profile-plugins/`. Users who installed the DMG therefore could not use the newly developed Team tools or roster UI.

## Decision

Make `@deepseek-ai/dsh-experimental-client-ui-agent-team` the desktop seed pin. Add `cordis.patch.yml` that disables the overlapping global continuable-child controls, inserts the Host Team service and tools, then inserts this package so the Client half mounts. Pin it in `desktop-profile-plugins.json` with `source: "workspace"`. Headless and source Web keep using `agent-team-profile` + `agent-team-web-profile`; the new patch is the desktop seed document only. Host packages remain resolvable through the CLI harness collect (`agent-team` / `tool-agent-team` are already CLI dependencies).

## Alternatives considered

- **New `desktop-agent-team` dual-face package that re-exports the Client UI.** Rejected: client feature plugins must not runtime-import or re-export another feature plugin; a thin wrapper would either violate that rule or duplicate the UI.
- **Pin `agent-team-profile` alone.** Rejected: seed validation requires `dsh.client` and a `./client` export.
- **Promote Agent Team out of experimental first.** Rejected: out of scope for making the fork desktop usable; promotion keeps its existing checklist.

## Consequences

- First desktop launch installs the Team Host tools and header roster UI for profiles that still carry the seeded bundle.
- Users who previously removed the bundle from their profile do not get it re-inserted on heal (same seed rule as other overlays).
- A stale `src/*.js` emit next to TypeScript sources shadows Vitest resolution and breaks `SessionLogOffset` / `SessionSeq`; clean those before trusting local Agent Team tests after a messy merge.
