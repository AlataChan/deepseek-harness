# Octopus DSH — Little Green Whale

English | [中文](README.zh.md)

Octopus DSH (`octopus_DSH`) is the AlataChan desktop-focused fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the open-source agent harness developed by DeepSeek AI. Little Green Whale is the in-app brand. This fork is maintained independently and is not an official DeepSeek desktop release.

The runtime retains DeepSeek Harness's **everything-is-a-plugin** architecture, powered by [Cordis](https://github.com/cordiverse/cordis). Octopus adds a Tauri 2 desktop shell, packaged runtime, and desktop plugins for everyday document, data, and team work.

## What you can do

- Chat with configured models and work with files in a selected workspace.
- Ask data: select or upload Excel/CSV data before starting a conversation.
- Ask knowledge: import documents into a library, search converted content, and approve model-assisted wiki enrichment separately.
- Save assistants and standing teams with editable responsibilities, model choices, and memory; follow team activity in the collaboration panel.
- Use voice transcription and conversation-driven media tools. Media generation requires its provider credentials; video composition requires a separately installed media runtime.

These additions are desktop plugins; the Web profile does not automatically include the desktop feature set. See the [getting-started guide](docs/user/guide/index.md) for the user entry points and the [desktop README](apps/desktop/README.md) for runtime and packaging details.

## Developer preview

Octopus DSH and its upstream runtime are evolving rapidly. Compatibility-breaking changes remain possible. Read the [safety notice](SAFETY.md) before running agents against local files or commands.

## Expansion and TUI qualification

Both implementation plans have passed independent review within their tested local scope. They are separate from desktop installer release qualification.

| Capability | Verified scope | Remaining qualification |
|---|---|---|
| IM, tenant isolation and remote Workers | Local implementation; disposable Linux tenant-isolation and SSH tests | Live Feishu/DingTalk delivery, production hosts, physical two-host SSH and CI |
| Interactive terminal TUI | Local macOS PTY, independent installed artifacts, native/Node PTC approvals and keyless Session replay | Linux native PTY, Windows ConPTY, cross-platform CI and production release |

The TUI is available through the `tui` CLI profile; it is not a default DMG/EXE plugin. Desktop IM setup is contributed by the [IM settings overlay](packages/experimental/desktop-im/README.md): Settings → IM integrations, with independent Feishu/DingTalk connection controls. Server IM services still require explicit profiles and authorized operator bindings. See the [combined completion status](.plans/feature-expansion-2026-10-24/completion-status.md), [expansion acceptance](.plans/feature-expansion-2026-10-24/expansion-completion.md) and [TUI acceptance](.plans/feature-expansion-2026-10-24/codex-tui-acceptance.md) for evidence and limits. Local documentation and hygiene blockers are resolved; see the [repair record](.plans/feature-expansion-2026-10-24/local-merge-repairs.md). Linux/Windows native qualification remains deferred; local acceptance does not imply production readiness.

## Run

### Desktop

Use the fork's [release page](https://github.com/AlataChan/deepseek-harness/releases) to check available installers and release-specific qualification. The distribution targets macOS arm64 DMG and Windows x64 NSIS EXE. Installers carry Node and the matching Harness runtime; end users configure their model API key in Settings. Signing, platform qualification, and artifact availability depend on the release; no automatic updater is enabled.

### Run from source

For contributors with Node.js `^22.19.0` or `>=24.0.0` and pnpm:

```sh
git clone https://github.com/AlataChan/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

The Web launcher uses built artifacts. See the [development guide](docs/development.md) for source workflows and the [desktop build instructions](apps/desktop/README.md#build-and-run) for Rust/Tauri prerequisites and installer preparation. Installing the upstream `@deepseek-ai/dsh` package does not install this fork's Octopus desktop application.

## Local data

The default Harness home is `~/.dsh`, configurable through `DSH_HOME`. Octopus does not automatically isolate that directory from another DSH installation. Applications using the same home can see the same conversations and settings; a different app name or installation directory does not create a separate history. See [local data and coexistence](docs/user/guide/index.md#local-data-and-coexistence) before using both installations.

## Documentation and support

- Start with the [user guide](docs/user/guide/index.md).
- Report fork-specific issues in [this repository](https://github.com/AlataChan/deepseek-harness/issues).
- Use the [upstream documentation](https://deepseek-harness.github.io/deepseek-harness/) for shared Harness concepts; it does not describe all Octopus desktop additions.
- Read [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/development.md), and [architecture documentation](docs/architecture.md) for engineering work. Agents follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
