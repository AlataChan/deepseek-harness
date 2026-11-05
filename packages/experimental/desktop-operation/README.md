---
description: "Desktop-operation preset that owns one shared macOS desktop session through the pinned agent-desktop MCP server."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-operation

English | [中文](README.zh.md)

## Summary

`desktop-operation` is a dedicated agent preset for one shared macOS desktop. Selecting it gives that Agent its own mcp-client against the pinned agent-desktop 1.2.0 binary and the packaged `agent-desktop` skill. The shared preset tree does not start the server. The standard preset is unchanged, and this package does not insert an MCP client at the profile root.

## Table of Contents

- [Use this package](#use-this-package)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The desktop profile seed installs this package. The registrar copies the preset into the user preset directory and registers `desktop-operation` on the existing agent-preset roster. On macOS Apple Silicon it may run `agent-desktop status` once and publish a sentence from `desktopOperationCopy`. An unsupported host spawns nothing and publishes the platform sentence. Registering the preset does not start the MCP server. `agent/created` starts one client for an Agent whose preset is `desktop-operation`. Unloading the registrar disposes every client it still owns, including one that has not finished starting. A later registrar's client stays when an older Agent is disposed. `AgentPresetSection` shows that description verbatim, and it shows `row.broken` when the preset mount audit fails. `presetDisplayText` localizes only the built-in preset ids, so this named preset does not switch locale on the card.

The supervisor takes an exclusive flock on `<appDataDirectory>/agent-desktop.lock` and never unlinks that file. It passes the same descriptor to `agent-desktop` on stdio fd 3, so a killed supervisor does not release the desktop while the child still has the descriptor. A second supervisor exits before spawn and writes `desktop-operation: shared desktop lease is held`. The process entry requires `--lock` and `--binary`; arguments after `--` are the child command, and a missing path exits 1 before the lock. `AGENT_DESKTOP_HOME` is always `<appDataDirectory>/agent-desktop`. The adapter does not change `HOME`.

Pinned `agent-desktop`, `agent-desktop-macos-helper`, `LICENSE`, `PIN.json`, and `skills/agent-desktop/SKILL.md` are staged offline into the seeded plugin `native/` directory. `scripts/build-dmg.sh` checks the archive sha256, stages those files, and runs `verify-agent-desktop-digest.ts --unsigned` once before the first codesign. Signed Mach-O bytes are not compared with the pin. Nothing in this package downloads a release or depends on the npm `agent-desktop` package.

<a id="config"></a>
## Config

```yaml
- id: desktop-operation
  name: '@deepseek-ai/dsh-experimental-desktop-operation'
  config:
    appDataDirectory: ''
    assetDirectory: ''
    statusTimeoutMs: 5000
```

`appDataDirectory` is the absolute parent of the state directory and the lock file. Empty uses absolute `OCTOPUS_APP_DATA`. A missing or relative value still registers the preset on a supported host. The Agent that selects it then fails during creation, because the supervisor exits before spawn, instead of failing the whole app. `assetDirectory` overrides the installed `native/` directory. Empty resolves `../native` beside the plugin.

## Model Experience

### Shared desktop catalog

#### What the model sees

An Agent that selects `desktop-operation` receives the pinned agent-desktop MCP catalog, 67 tools from `desktop_snapshot` through `desktop_trace_export`, and the packaged `agent-desktop` skill. Another live Agent does not receive those tools. Tool results are the server's own envelopes. A synthetic permission denial and `error.code` `STALE_REF` are classified by this package and are not retried here. This package does not add a session event or a core-loop listener.

#### Token effect

The tool definitions and the skill text enter the request while this preset is selected. The catalog is large relative to the standard preset because all 67 tools are mounted together. Results stay on the tool-call path; this package does not copy them into an extra prompt section beyond the MCP server instructions the current mcp-client already publishes.

#### KV Cache effect

The catalog and skill are stable for the life of the preset selection. A refused second desktop session does not change the tool list. Cancelled calls and a disposed connection remove only that call's result, not the definitions.

## Known Limitations and Deferred Work

- **One desktop** — the flock admits one live agent-desktop child for the app-data lock. A second Agent's client exits before spawn and that creation fails. After the first Agent is disposed, a later Agent can take the lock. Unloading the registrar releases that lock only after the client's cleanup settles.
- **macOS Apple Silicon** — other platforms register the preset and do not start a client. The registrar publishes the Chinese platform sentence from `desktopOperationCopy`.
- **Permissions** — `granted` and `unknown` are not denials. Any other permission state publishes the Chinese denial sentence from the same dictionary. A missing, corrupt, or timed-out status publishes the unavailable sentence and still registers the preset. This app does not change TCC. The card cannot localize that sentence until named presets gain a display-key hook. `statusTimeoutMs` defaults to 5000.
- **Unsigned once** — binary hashes in `PIN.json` are the bytes before codesign. The bundle check does not hash the signed binaries.
- **No first-launch download** — a missing archive fails `build-dmg.sh`. The binaries are not committed.
- **Call timeout** — the per-Agent client keeps `toolCallTimeoutMs` from the packaged preset row, and mcp-client validates it. Reconnect stays off, and startup failure fails that Agent's creation.
- **Reconnect stays off** — a crashed server is not respawned by mcp-client.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
