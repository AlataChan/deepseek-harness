# @deepseek-ai/dsh-host-workspace-entries

English | [中文](README.zh.md)

The web GUI host's one-level project-file listing is a capability seam. The abstract `WorkspaceEntries` service (`ctx.workspaceEntries`) is its Service Definition. Its only method, `list({ root, path? }, signal)`, lists one directory level inside a Host-owned project root. Providers implement the filesystem fence and row kinds (`file` / `directory` / `broken-symlink`). The Consumer is official `session.listEntries`: it derives `root` from the named session's `cwd` and maps `WorkspaceEntriesError` onto the wire. An absent service fails as `session/entries-unavailable`. Clients never send a root.

Listing failures throw the typed `WorkspaceEntriesError` (`entries-unreadable` / `entries-outside-root`). Row `hidden` is the POSIX dot-prefix convention; display policy stays client-side. Every row `path` is an absolute Host path.

The octopus_DSH desktop file tree is the experimental Provider plus Client occupant (`@deepseek-ai/dsh-experimental-desktop-files`). Official web compositions omit that package, so `sidebar.files` stays empty and the 文件 tab is not drawn.

## Model Experience

None, as the seam serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No in-app editor or preview** — clicking a file uses the existing `host.openPath` native opener.
- **One level per call** — expansion is a later `list` of that row's absolute path, still fenced to the same session `cwd`.
