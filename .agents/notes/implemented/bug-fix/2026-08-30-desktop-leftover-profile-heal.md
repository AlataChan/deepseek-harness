# Agent Note: Heal leftover 0.1.1 desktop profile rows on 0.1.2

Status: implemented

English | [中文](2026-08-30-desktop-leftover-profile-heal.zh.md)

## Problem

A machine that ran 0.1.1 octopus_DSH keeps `~/.dsh/profiles/desktop` listing `@deepseek-ai/dsh-client-app` plus, on this fork, `dsh-context`. After the 0.1.2 merge, `dsh-base` owns `id: storage` and the desktop template is `dsh-base` + `dsh-web-app` + `dsh-desktop-app`. `normalizeShippedProfile` only rewrote an exact installation-owned tuple, so a profile with extra overlays never migrated. The leftover `dsh-client-app@0.1.1-rc.5` still lives under `~/.dsh/profiles/node_modules` and also registers `storage`. The new companion then fails at apply with `duplicate loader entry id: storage`, and the window never reaches ready.

## Decision

Every profile load rewrites `@deepseek-ai/dsh-client-app` to `@deepseek-ai/dsh-web-app` and writes the manifest back, including lists that still have extra user bundles. Fork first-launch and `scripts/seed-desktop-profile-plugin.mjs` do the same rewrite and also drop `dsh-context` from `bundles` and `dependencies`. The first-launch shipped tuple is `dsh-base` + `dsh-web-app` + `dsh-desktop-app`. `verify-desktop-bundle.sh` rejects a pin or shipped tuple that still names `dsh-client-app`, and it heals a dirty fixture before passing.

Official companion product logic stays unchanged. `dsh-desktop-app` disables `client-hmr` because the Tauri WebView rejects the web EventSource channel (`The operation is insecure`) and otherwise the window stays on Failed to load plugins. Workspace ask-data pins install third-party deps such as `exceljs` so first-launch overwrite does not brick Host apply.

## Alternatives considered

**Leave leftover profiles for the user to edit.** Rejected: the 0.1.2 companion cannot start, so the user never reaches a UI that could explain the edit.

**Rewrite only an exact `base + client-app + desktop-app` tuple.** Rejected: this fork's live profiles always have extra overlays, which is exactly the list that stayed broken.

**Put `dsh-context` stripping in official `app-boot`.** Rejected: that leftover is fork-owned. Official load only rewrites the renamed installation bundle.

## Consequences

Opening the 0.1.2 companion on a 0.1.1 desktop profile writes `dsh-web-app` in place of `dsh-client-app` before the loader resolves bundles, so `storage` is registered once. First launch also removes `dsh-context`. Extra overlays such as desktop-files stay. A dirty-fixture heal is part of `verify-desktop-bundle.sh`.
