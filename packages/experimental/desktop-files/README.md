# @deepseek-ai/dsh-experimental-desktop-files

English | [中文](README.zh.md)

Private octopus_DSH overlay: the Provider for [`ctx.workspaceEntries`](../../host/workspace-entries/README.md) plus the Client occupant of `sidebar.files`. Official `dsh-desktop-app` and `PROFILE_TEMPLATES.desktop` do not name this package. The desktop profile seed copies the built tree (`source: "workspace"` in [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)).

The Host default export is `DesktopWorkspaceEntries`. `list({ root, path? }, signal)` lists one directory level inside `root`. The fence is fully-qualified paths, lexical containment (including Windows cross-drive `path.relative`), and `realpath` containment; `opendir` uses the canonical directory. One level is bound at `config.maxEntries` (default 1000) and then `truncated`. Names `{ node_modules, .git, dist, coverage }` are omitted. Directory symlinks whose `realpath` leaves `realpath(root)` fail as `entries-outside-root` and do not list the outside tree.

The Client face registers through `ctx.slots.inject('sidebar.files', …)`. The tree root is the current session `cwd` via `session.listEntries({ sessionId, path? })` — the client never sends a `root`. File clicks call `session.openWorkspacePath`. Broken symlinks stay red and do not open. Hidden rows are a client-only filter. Official web leaves `sidebar.files` empty; occupancy (not `renderSlot` truthiness) is what draws the 会话 / 文件 switch.

## Config

```yaml
- id: desktop-files
  name: '@deepseek-ai/dsh-experimental-desktop-files'
  config:
    maxEntries: 1000
```

`cordis.patch.yml` inserts this one Host row. The Client half is discovered from `dsh.client` after the Host fiber is live.

## Model Experience

None, as the overlay serves the GUI file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No in-app editor or preview** — a file click uses the system default application.
- **No Git, terminal, or float windows** — v1 is the session-cwd tree only.
