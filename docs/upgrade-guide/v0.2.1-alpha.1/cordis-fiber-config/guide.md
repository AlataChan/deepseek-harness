---
kind: upgrade-guide
description: "Cordis Fiber config exposes raw input instead of parsed plugin values."
---

# Read parsed Fiber configuration explicitly

English | [中文](guide.zh.md)

## Change

`fiber.config` and `fiber.rawConfig` contain raw plugin input. Parsed defaults, transforms, and volatile references are available through `fiber.effectiveConfig`. Plugins still receive parsed configuration as their configuration argument. Integrations that inspect another plugin through its Fiber must choose the intended representation.

## Migration

1. Find integrations that read `fiber.config` or retain its object identity. Use `fiber.effectiveConfig` when reading live plugin values or volatile references; narrow its `unknown` type using the owning plugin's configuration type.
2. Keep raw input reads on `fiber.rawConfig`, and keep persisted edits on the existing configuration editor or update path. Do not serialize parsed references into profile configuration.
3. Test omitted schema defaults, an in-place volatile update, and a change that remounts the plugin. Confirm that settings display parsed values while the saved profile retains plain input.

See the [Fiber reference](../../../cordis-api/fiber.md) for the raw and effective configuration APIs.
