# Agent Note: octopus_DSH desktop file workbench

Status: implemented

English | [中文](2026-08-28-desktop-file-workbench.zh.md)

## Problem

octopus_DSH desktop users need to see the current session's project files without leaving the chat column. Official web has no file tree. Putting a tree into `dsh-desktop-app` or `PROFILE_TEMPLATES.desktop` would change the shipped desktop composition for every consumer of those official packages. Directory-picker browse lists folders only and defaults to the host home, so it cannot be the session-cwd file tree.

## Decision

The listing seam is official. [`@deepseek-ai/dsh-host-workspace-entries`](../../../../packages/host/workspace-entries/README.md) is the Service Definition (`ctx.workspaceEntries`). Official `session.listEntries` is the Consumer: it takes `{ sessionId, path? }`, derives `root` from that session's `cwd` (live header, else `sessionPersistence.list()`; it does not resume the agent and does not call `inspectApiSession`), and maps `WorkspaceEntriesError` onto `session/entries-unreadable` or `session/entries-outside-root`. Clients cannot send a `root`. An absent service fails as `session/entries-unavailable`. File clicks use existing `session.openWorkspacePath`.

The Provider and the Client tree live in the private overlay [`@deepseek-ai/dsh-experimental-desktop-files`](../../../../packages/experimental/desktop-files/README.md). Its patch inserts one Host row; `dsh.client` discovers the Client face. The Client calls `ctx.remote.session.listEntries` / `openWorkspacePath` and registers with `ctx.slots.inject('sidebar.files', …)`. Official `ui-sidebar` declares the `sidebar.files` hole and an occupancy hook (`ctx.slots.entries` + `subscribe`, injected as `useFilesOccupied`). Occupancy, not `renderSlot` truthiness, draws the 会话 / 文件 switch; an empty hole leaves official web unchanged.

Path fence: fully qualified; lexical containment including Windows cross-drive `path.relative`; `realpath` containment; `opendir(realPath)`. A directory symlink whose realpath leaves the session cwd fails as `session/entries-outside-root` and does not list the outside tree. There is no in-app editor or preview.

Seed follows [`scripts/desktop-profile-plugins.json`](../../../../scripts/desktop-profile-plugins.json). The overlay is `source: "workspace"`: copy the built package tree (not `npm pack`) to `node_modules/<package.json name>`, including scoped `@scope/name`. A dest that is a symlink is rejected. First-launch Tauri install reads `package.json` name/version and recurses `@` folders. `verify-desktop-bundle.sh` validates every pin and requires the generated session-controller remote face to export `listEntries`.

The desktop Host and WebView carrier that this overlay rides are recorded in [the web-app Host note](../architecture/2026-08-30-desktop-web-app-host-carrier.md). Official `desktop-app` `cordis.patch.yml` does not name the overlay.

## Alternatives considered

**Add the overlay to `dsh-desktop-app` or `PROFILE_TEMPLATES.desktop`.** Rejected: that rewrites official desktop composition for every consumer, against the fork rule that course/overlay work must not change those product packages.

**Reuse directory-picker browse (`listDirectory`).** Rejected: that method lists directories only, defaults to the host home, and is the picker browse contract, not a session-cwd file tree.

**Draw 文件 from `renderSlot('sidebar.files')` truthiness.** Rejected: `renderSlot` always returns a `<SlotOutlet>` wrapper, so the tab would appear on official web with an empty hole.

**Let the client send `root`.** Rejected: a client could list outside the session cwd. The Host owns the fence and derives root from `sessionId`.

**Resolve a missing cwd through `inspectApiSession`.** Rejected: that path reports a session without cwd as not-found, so a cold blank session looks missing instead of unreadable.

**Keep unprefixed `entries-*` wire codes.** Rejected: 0.1.2 Remote codes are `<domain>/<reason>` and live in one `RemoteErrorDetailsMap`. The Provider still throws in-process `WorkspaceEntriesError` with the unprefixed names; only the Consumer's wire codes carry the `session/` prefix.

**`npm pack` the workspace overlay.** Rejected: the overlay is private and unpublished; the seed copies the built tree.

## Consequences

A seeded octopus_DSH desktop profile loads the overlay and shows 会话 / 文件. Official web default composition does not show 文件. A user who removes the bundle name keeps it removed on later seed refresh. `verify-desktop-bundle.sh` refuses a DMG whose embedded overlay is missing, not a loadable `dsh.bundle` + `dsh.client` package, or whose session-controller remote face lacks `listEntries`. There is still no editor, preview, terminal, Git panel, or float window. The WebView talks Typert remotes through `__DSH_TRANSPORT__`; a Host `@Remote` added to session-controller is invisible in the window until that generated remote face is rebuilt.

## Testing

Package tests cover the SD invariant, `session.listEntries` mapping (live cwd, persistence list, absent capability, outside-root, abort), listing fence (including win32 `relative` and realpath escape), sidebar occupancy register/dispose, FileTree abort-on-session-change, and scoped/symlink seed. Default official web snapshots must not contain 文件.
