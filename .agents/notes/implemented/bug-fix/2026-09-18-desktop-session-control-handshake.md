# Agent Note: Wait for sessionController before desktop handshake

Status: implemented

English | [中文](2026-09-18-desktop-session-control-handshake.zh.md)

## Problem

octopus_DSH default `workspaceRoot` is the user home directory. `connection-desktop` answers `control/ready` as soon as `connection`, `clientModules`, and `typertGateway` exist. The WebView then opens `session/control`. That stream looks up the live `sessionController` service. `sessionController` injects `workspaceRegistry`, which is still pending while the workspace plugin starts against `$HOME`. The companion treats the missing service as `gateway-failure` and exits. The window reconnects, boots a new companion, and loses the race again. The visible Client error is `agentTeams/listInstitutionSquads` wrapped around that companion death.

## Decision

The seeded desktop-files overlay restates the official `connection-desktop` row so it also injects `sessionController`, and restates `workspaceRoot: !!js ctx.desktopStartup.workspaceRoot`. Handshake cannot complete until Session Controller is provided. Official `apps/desktop`, `dsh-desktop-app`, and desktop-companion stay unchanged. `verify-desktop-bundle.sh` requires `sessionController` on that overlay row in source and in the bundled profile-plugin copy.

## Alternatives considered

**Change official `packages/bundle/desktop-app/cordis.patch.yml`.** Rejected: course and overlay work must not change official desktop-app product composition. The inject belongs on a seeded overlay that every octopus_DSH profile already loads.

**Catch `openStream` failures in official `connection-process` instead of `fail('gateway-failure')`.** Rejected for this fix: that is official companion gateway behavior, and a reconnecting client would still open `session/control` before the service exists unless handshake waits.

**Keep the handshake and retry `session/control` in Agent Team UI.** Rejected: the control stream is opened by official Session Controller Client, not by the squad row. A unary `listInstitutionSquads` error is only what the Hero happens to display after the companion has already exited.

**Delay ready in a new overlay package.** Rejected: desktop-files is already the first seeded dual-face bundle and already depends on a live `sessionController` for `session.listEntries`.

## Consequences

A first launch whose workspace is `$HOME` stays on connecting until `sessionController` is live, then the control stream opens. Removing the desktop-files bundle name restores the reconnect loop. Official web and headless profiles are unchanged.

## Testing

Package test `packages/experimental/desktop-files/tests/connection-ready.spec.ts` reads `cordis.patch.yml` and requires the `sessionController` inject plus the restated `workspaceRoot` expression. `verify-desktop-bundle.sh` repeats that check on the source patch and the seeded `profile-plugins` copy.
