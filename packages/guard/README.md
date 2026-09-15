---
description: "Package map for agent-loop guard plugins covering repeated calls, call deadlines, and structural fencing of selected external tool results."
kind: "package-group"
---

# guard/ — agent-loop guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group provides focused policies around tool execution. `repeat-tool-reminder` advises a model that repeats an identical call, `timeout-policy` enforces declared call deadlines, and `fence-policy` marks selected third-party result text as external data while neutralizing structural prompt-injection forms. All three ship in the `dsh` base bundle, and fence policy remains available for explicit compositions.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package owns one policy and documents its composition requirements.

| Package | What it provides |
|---|---|
| [`fence-policy/`](fence-policy/README.md) | Escapes and fences selected external tool-result text before it reaches the model |
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the generated configuration and the timeout-library decision behind the deadline policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions both guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
