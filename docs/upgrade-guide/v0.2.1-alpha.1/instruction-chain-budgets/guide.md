---
kind: upgrade-guide
description: "The agent-instructions maxBytes setting now limits each instruction chain separately instead of their combined message."
---

# Separate instruction-chain budgets

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-agent-instructions` applies `maxBytes` independently to user-global instructions and project instructions. Previously both chains shared one message budget. A baseline or dynamic batch containing both chains can now occupy up to twice `maxBytes`. A chain cannot borrow unused capacity from the other chain. Non-positive or non-finite values still disable instruction loading.

## Migration

1. Find the `@deepseek-ai/dsh-agent-instructions` row in your `cordis.yml` or profile patch. If the larger combined bound is acceptable, keep `maxBytes` unchanged. The `dsh-base` setting of `65536` now permits up to `131072` bytes when both chains are present.
2. To conservatively retain the previous combined byte bound, set `maxBytes` to half its previous value, rounded down. For example, replace `65536` with `32768`. This may truncate either chain sooner; the previous shared-pool allocation is unavailable.
3. Start a session with both user-global and project instruction files. Inspect the logged instruction message and confirm its UTF-8 size remains within your chosen combined bound. See the [package reference](../../../../packages/context/agent-instructions/README.md) for discovery and truncation behavior.
