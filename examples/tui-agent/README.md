# TUI agent

English | [中文](README.zh.md)

This example exercises the shipped interactive terminal profile through the real `dsh` launcher and Cordis Loader. It is an overlay, so the application remains the production `tui` profile rather than a test-only hand-mounted tree.

## Run

From the repository root, install dependencies and start the terminal client:

```sh
pnpm install
pnpm dsh
```

The default command starts a fresh Session. Use `pnpm dsh --resume` to choose a recent Session or `pnpm dsh --resume <session-id>` to resume one directly. stdin and stdout must be interactive terminals; use `pnpm dsh exec "task"` for non-interactive automation.

The production overlay in [cordis.yml](cordis.yml) selects plain JSONL persistence so the example transcript remains inspectable. [cordis.snapshot.yml](cordis.snapshot.yml) replaces the live model with deterministic replay for the keyless terminal snapshots.

## Terminal controls

- Enter submits; Ctrl+J inserts a newline.
- Ctrl+R or `/resume` opens the bounded Session selector.
- Ctrl+C cancels active work. When idle, it clears a non-empty draft before an empty-draft press exits.
- Escape closes an overlay or rejects the current interaction.
- `/help` lists commands and `/exit` saves and exits.

The e2e tests boot the real production overlay through the Loader. The keyless smoke verifies help and clean terminal restoration; the live-model smoke self-skips without `DEEPSEEK_API_KEY`. Three replay scenarios pin transcript, approval and question interaction, cancellation, persistence, and terminal shutdown behavior.
