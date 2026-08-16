# `@deepseek-ai/dsh-client-app`

English | [中文](README.zh.md)

The transport-neutral interactive client bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md), inserts the shared Host services and Client Plugin roster, and moves model-facing rows behind per-session Agent Presets. It owns ApiProxy, persistence and workspace support, Client module discovery, the Client runtime, shared `ui-*` plugins, and the preset roster. It owns no physical connection provider, server, static frontend, browser download, directory picker, or surface startup behavior; a later surface bundle supplies those rows. The shipped Web profile composes this bundle before [`dsh-web-app`](../web-app/README.md), and the VS Code profile can compose the same client behavior without inheriting a browser server.

The bundle keeps shared row order stable. A later surface layer appends its own rows, so dependencies and Cordis injection rather than cross-bundle row interleaving determine activation.

## Model Experience

Indirectly, through the inserted rows: the bundle selects the coding persona, shared interactive tool-presentation setting, per-session preset composition, and Client Plugin roster. It contributes no model-visible text of its own.

#### KV Cache effect

None directly; each inserted row owns its effect.

## Known Limitations and Deferred Work

- **A surface bundle is required** — this bundle deliberately provides no connection carrier or user-facing shell and is not independently runnable.
