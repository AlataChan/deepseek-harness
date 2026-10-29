---
description: "The dsh TUI bundle: interactive terminal user interface application layer over dsh-base."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-bundle

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tui-bundle` is the bundle layer composing the interactive terminal user interface (`@deepseek-ai/dsh-tui`) over `dsh-base`. It mounts the TUI adapter and configures terminal-friendly execution flags for `dsh --profile tui`.

## Table of Contents

- [Use this package](#use-this-package)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The bundle is included automatically in the `tui` profile template. Start the TUI via the launcher:

```sh
dsh --profile tui
```

<a id="composition"></a>
## Composition

The bundle declares a patch layer in `cordis.patch.yml` that inserts `@deepseek-ai/dsh-tui` and configures execution environment properties.

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Profile layer only** — this bundle is designed to be composed over `dsh-base` within a profile, not launched as a standalone root.
- **Platform qualification** — the installed profile passes local macOS review; Linux PTY, Windows ConPTY and production release remain unverified. See the [combined status](../../../.plans/feature-expansion-2026-10-24/completion-status.md).

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
