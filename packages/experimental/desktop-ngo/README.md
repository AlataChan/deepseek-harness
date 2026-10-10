---
description: "Install and register the octopus_DSH public-service project assistant preset."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-desktop-ngo

English | [中文](README.zh.md)

## Summary

This fork package installs the 公益项目助手 (public-service project assistant) preset into the Harness home and registers it on the agent-preset roster. The preset ships the Markdown skills for proposal writing, field ledgers, case extraction, communications drafts, and desensitisation. Activation copies missing preset files without overwriting existing ones and repairs a composition this runtime cannot mount.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The desktop profile seed installs this package from `scripts/desktop-profile-plugins.json`. On activation it writes the packaged preset to `<DSH home>/.agent-presets/env-ngo-project-assistant`: the composition (`agent.cordis.yml`, `preset.yml`) and the skill tree with its templates. A fresh directory is copied whole; an existing directory keeps every file it already has and gains files that are missing, so user edits survive while newly shipped skills arrive. The installed preset registers under `env-ngo-project-assistant` with the display name 公益项目助手 and appears in the 专项助手 entry.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`installNgoPreset` treats a directory whose composition still names a removed package, or whose persona row still uses the old `text` key, as needing repair and rewrites those two files from the package; everything else is additive. Registration reads the installed composition through `entryListSchema` and skips registration with a logged error when the file cannot be parsed.

</details>

<a id="model-experience"></a>
## Model Experience

None, as the preset definition owns every model-visible persona, instruction, and skill this installer registers.

#### KV Cache effect

None; the package changes composition only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Additive refresh only** — a file deleted from an existing preset directory is restored on the next activation; a per-file deletion opt-out needs an explicit marker.
- **No uninstall path** — removing the preset is manual: delete the preset directory and the roster entry disappears on the next activation.
