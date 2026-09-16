# Agent Note: Ship commerce mode into the octopus_DSH desktop profile plugins

Status: implemented

English | [中文](2026-09-15-commerce-desktop-profile-plugin.zh.md)

## Problem

Commerce mode lived only under `packages/experimental/` with automation snapshots and a source Web lane. DMG seeding reads [scripts/desktop-profile-plugins.json](../../../../scripts/desktop-profile-plugins.json) and requires each pin to be a dual-face package (`dsh.bundle.patch` + `dsh.client` + `./client` on disk), so nothing in an installed app mounted the commerce Provider, its preset, its tools, or the 电商助手 page. Seeding also drops a pin's `workspace:` peers, so a Host package that only commerce needs would be missing from the installed tree even after the pin copied cleanly.

## Decision

Pin `@deepseek-ai/dsh-experimental-commerce-mode` itself, after the ask-data pin, with `source: "workspace"`. The package already ships both faces: its `cordis.patch.yml` mounts the file-backed Provider and the `./preset` row, which installs the packaged `commerce` preset and mounts the commerce tools in that preset's standing scope, while `./client` serves the change cards and the 电商助手 chip with its source gate. `@deepseek-ai/dsh-host-commerce` joins `apps/cli` dependencies so the Service Definition resolves from the harness collect rather than through Session Controller's peer edge. The packaged fictional sample and the adapted-skill `NOTICE` travel in the pin's `files`, and `verify-desktop-bundle.sh` now fails the build when a seeded commerce copy lacks the preset directory, the sample tables, or `NOTICE`.

## Alternatives considered

- **A separate desktop-commerce wrapper package**, as Agent Team needed. Rejected: commerce mode is already dual-face, so a wrapper would add a package with no owner and another version to keep aligned.
- **Relying on Session Controller's `dsh-host-commerce` peer for the closure.** Rejected: the installed tree would lose the seam the moment that peer changed, and a profile plugin's Host dependencies belong in the app's own dependencies.
- **Seeding the Provider without the `./preset` row.** Rejected: the desktop composition carries a preset roster, and the preset scope is what keeps commerce tools off every other preset.
- **Copying the spreadsheet decoder into the commerce pin.** Rejected: ask-data is a sibling pin that already ships it; a second copy doubles the bytes and diverges on update. The Host face imports `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet` directly.
- **Letting the gate page import ask-data's client byte helpers.** Rejected by the client bundle purity gate: a browser bundle may not value-import a sibling plugin's `/client`, because module-table identity is per plugin. The page folds upload bytes with `bytesToBase64` from the inline-safe `@deepseek-ai/dsh-util-crypto` and reads the `File` inline.

## Consequences

- First desktop launch merges the commerce bundle into the desktop profile; a user who removes it is not re-seeded, the same rule the other overlays follow.
- An installed app reaches commerce through the 电商助手 chip: sample or per-kind upload, analysis, staged changes, merchant approval, and a CSV written into the session workspace. Nothing is sent to a store.
- A commerce pin that loses its preset directory, its sample tables, or its `NOTICE` fails the packaging gate before a DMG exists.
- The experimental package stays out of the app's dependency closure; `dsh-host-commerce` is the only dependency the app gains, and `apps/cli/tests/profile-link-bundle.spec.ts` keeps that boundary honest for the link path.
