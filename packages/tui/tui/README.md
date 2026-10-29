---
description: "Interactive terminal user interface for DeepSeek Harness, providing raw keyboard handling, rich rendering, question and approval flows, and deterministic terminal state restoration."
kind: package-reference
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tui` provides an interactive terminal user interface for DeepSeek Harness. It runs inside the user's terminal emulator using raw mode, bracketed paste, multiline prompt buffering, grapheme-aware Unicode column measurement, bounded scrollback history, streaming assistant updates, interactive user question selection, and tool execution approval and rejection. It integrates with `@deepseek-ai/dsh-app-boot` terminal restore services to attempt synchronous terminal restoration before fatal diagnostics and during shutdown.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the installed CLI profile in an interactive terminal. The launcher owns application startup and shutdown; mounting this plugin alone does not provide the required Agent runtime.

```sh
dsh --profile tui
```

Inside the TUI, use `/help`, `/new`, `/sessions`, `/resume <sessionId>`, `/model` and `/quit`. Resume is an interactive command, not a launcher `--resume` option. Standard input and output must both be TTYs; use the existing headless profile for piped execution.

<a id="configuration"></a>
## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `locale` | `'zh' \| 'en'` | `zh` | UI display language |
| `maxScrollbackLines` | `integer` | `2000` | Retained lines; range 10–100000 |
| `maxScrollbackLineLength` | `integer` | `4096` | Characters per retained line; range 10–65536 |
| `maxInputBytes` | `integer` | `32768` | Draft bytes; range 64–1048576 |
| `maxPasteBytes` | `integer` | `65536` | Paste buffer bytes; range 64–1048576 |
| `maxHistoryEntries` | `integer` | `500` | Prompt history entries; range 10–10000 |
| `maxStreamAccumulatorChars` | `integer` | `32768` | Streaming characters retained; range 256–1048576 |
| `redrawIntervalMs` | `integer` | `33` | Streaming redraw interval in milliseconds; range 10–1000 |

Invalid values fail configuration; they are not silently clamped. Defaults and bounds are owned by [config.ts](src/config.ts).

<a id="model-experience"></a>
## Model Experience

None, as the TUI adds no model instruction text; model choices, ordinary user messages and interaction responses use the existing Agent services.

#### KV Cache effect

The interactive TUI adds nothing to the request prefix; it only submits user messages and interaction responses.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Interactive TTY required** — the plugin requires an interactive TTY and does not support headless or piped execution.
- **Single active session** — the current TUI manages one foreground session at a time and switches sessions via commands.
- **Platform qualification** — local macOS PTY, installed native/Node PTC interaction and keyless Session replay pass independent review. Linux native PTY, Windows ConPTY, live-provider and production-release validation remain unverified. See the [acceptance record](../../../.plans/feature-expansion-2026-10-24/codex-tui-acceptance.md).
- **Terminal recovery limits** — restoration is best-effort; SIGKILL, native abort or a lost TTY cannot guarantee recovery. Explicit detached-mode behavior is documented in the [CLI guide](../../../apps/cli/README.md).

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
