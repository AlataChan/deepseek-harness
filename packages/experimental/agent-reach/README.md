---
description: "Default desktop platform-reading plugin with separately approved, hash-locked runtime setup."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-agent-reach

English | [中文](README.zh.md)

## Summary

The Octopus desktop seed enables this lightweight Host/Client bundle. It adds platform discovery, local status, bounded read queries and a separate dependency installer to existing conversations. It starts no listener and downloads nothing at boot. The bundle adds no Python runtime, Agent-Reach environment, browser or media binaries to the desktop payload.


## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Runtime ownership](#runtime-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## Use this package

Ask for a platform read. If prerequisites are missing, `reach_setup` presents a frozen installation plan through DSH's existing approval service. Every installation requires a fresh interactive grant, including in full-access sessions; `never`, rejection, unavailable answerers and cancellation download nothing. `planOnly` previews without mutation. Submit a fresh query after setup; the installer never replays an old query.

[The user guide](../../../docs/user/guide/agent-reach.md) owns first use and cleanup. Existing conversations and Team agents inherit ordinary tool visibility; no special agent preset is required.

<a id="configuration"></a>

## Configuration

The `agent-reach` Cordis row accepts the validated settings declared in `Config`. The service resolves defaults once: omitted or undefined channel settings retain the defaults, and an explicit empty channel list disables queries. It copies both policy lists so later caller mutation cannot change live permissions. `enabledChannels` initially contains Bilibili, YouTube and V2EX; experimental channels need separate permission. `enableSetupTool: false` hides installation while preserving the three read tools. `runtimeOverride` must be an absolute, administrator-qualified launcher; ambient PATH discovery is disabled.

`sessionAccessRoutes` defaults to an empty list. Entries name exact `channel/action/backend` tuples; wildcards and unknown tuples are rejected. Bilibili subtitles require explicit permission for browser discovery, cookie import and native credential writes. Setup permission never grants session permission. Browser-launch backends remain unsupported until shared-process ownership is qualified. Unknown install recipes return unsupported rather than invoking upstream downloaders.

Output, concurrency, query/setup deadlines and teardown grace are configurable. `maxOutputChars` bounds the aggregate variable strings, including item fields, attempts and diagnostics; fixed JSON keys and status enums are overhead. Complete CLI JSON has a separate byte limit. The runner never retries queries.

<a id="runtime-ownership"></a>

## Runtime ownership

`dependency-lock.json` fixes uv, Python distributions and every wheel, including transitive and build dependencies. The pinned source archive is reproduced with the frozen builder; its wheel digest must equal the independently qualified digest before installation. The published upstream wheel is not substituted merely because its version matches. Installation uses offline, no-resolution, hash-enforced wheel installation after acquisition.

Generations live under `<DSH_HOME>/runtimes/agent-reach/releases/<lock-id>/generations/`. Their absolute venv paths remain stable; an atomic owner-record replacement promotes a verified generation. Failed setup removes only its generation and preserves the prior record. A per-release lock prevents simultaneous installers; an interrupted lock requires administrator inspection. Record schema upgrades are runtime-owned; unsupported versions and corrupt or escaping paths are refused. Account state remains upstream's OS-user state, shared between profiles using that account.

Upstream-private tools can precede PATH. Conflicting or unreadable private tool locations fail before backend execution and are never changed automatically. Install only from the frozen source; the similarly named PyPI project is not a substitute.

<a id="model-experience"></a>

## Model Experience

### Platform reading and setup

#### What the model sees

Discovery exposes action parameters, backends, effects and enablement. Results retain source URLs, explicit access/completeness facts and bounded attempt history. Unverified content stays unknown; snippets, subtitle-track lists and partial comments are not advertised as complete. Arbitrary raw payloads and update notices are omitted, and credential-shaped output is scrubbed before rendering. Credentials entered in user messages or tool arguments remain subject to normal Session logging; never request them in chat.

#### Token effect

`reach_query` retains bounded items and diagnostics; setup plans list fixed dependencies. Card result metadata adds no model text.

#### KV Cache effect

Tools and guidance stay stable while enabled. Query/setup results append to the current turn; changing plugin configuration changes subsequent request prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Platforms:** Runtime installation and execution are enabled only on qualified macOS Apple Silicon hosts. Other hosts retain discovery but cannot start downloads or backends. Other artifact recipes require separate qualification.
- **External access:** Platforms can require login or impose rate limits. macOS containment tests do not establish Windows/Linux acceptance; shared browsers are not owned query resources.
- **Excluded actions:** No posting, messaging, account setup, transcription, FFmpeg installation or general package management is exposed.

<a id="dev-note"></a>
### Dev Note

Artifact recipes do not establish execution qualification. Release acceptance records identify verified platforms and actions.
