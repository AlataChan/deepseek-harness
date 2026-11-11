# Contributing to Octopus DSH

English | [中文](CONTRIBUTING.zh.md)

This repository maintains the AlataChan Octopus DSH fork of DeepSeek Harness. Report Octopus desktop, packaging, or bundled-plugin issues in [this fork's issue tracker](https://github.com/AlataChan/deepseek-harness/issues). Include your operating system, app version, reproduction steps, and redacted diagnostics; do not attach API keys or private conversation logs.

## Development

Start with the [development guide](docs/development.md), [architecture](docs/architecture.md), and [AGENTS.md](AGENTS.md). Desktop contributors also need the [Tauri build and runtime guide](apps/desktop/README.md) and [release preparation](docs/cookbook/desktop-releases.md).

Keep fork desktop additions in their owning plugins and register changes to protected upstream paths in the [upstream intake registry](scripts/upstream-intake-registry.ts). Source package names retain `@deepseek-ai/dsh-*`; that namespace alone does not identify an official DeepSeek distribution.

## Changes and verification

Keep changes scoped, update the owning documentation and bilingual counterpart, and run checks relevant to the affected behavior. Follow the [pre-push workflow](.agents/skills/dsh-pre-push-checks/SKILL.md) before pushing. Submit fork work to this repository; do not direct Octopus-specific changes to upstream.

## Ecosystem

Plugins can extend the shared Harness runtime. Use the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to make them discoverable and describe compatibility accurately. The [upstream project](https://github.com/deepseek-ai/deepseek-harness) owns its own contribution and branding policies; this fork does not speak for DeepSeek.
