---
description: "Terminal user interface interactive application layer over base, providing an in-terminal interactive conversation loop."
kind: "package-group"
---

# packages/tui

English | [中文](README.zh.md)

## Summary

The tui group provides an interactive terminal user interface for DeepSeek Harness. It runs directly inside the user's terminal emulator with raw keyboard input, bracketed paste, multiline editing, grapheme-aware rendering, streaming assistant updates, interactive user question prompts, tool approval and denial, and best-effort terminal state restoration.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tui`](tui/README.md) | Interactive terminal user interface for DeepSeek Harness | — |

-----

<a id="related-documentation"></a>
## Related documentation

- [Terminal subsystem reference](../../docs/subsystems/terminal.md) — terminal session lifecycle, interactive keystroke streaming, and cleanup contracts.
- [Profile management](../../docs/subsystems/boot.md) — how the `tui` profile is composed and loaded.
- [app-boot](../boot/app-boot/README.md) — how the `tui` profile is composed and loaded.
- [dsh-tui-bundle](../bundle/tui/README.md) — the bundle composing the TUI layer over `dsh-base`.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
