# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

`dsh-tui` is the Node-only inline terminal client. It runs inside the Host Cordis tree, renders durable session events and live agent interaction, and does not add an RPC, HTTP, WebSocket, or browser layer.

## Runtime role

The package owns terminal presentation and input lifecycle for one root agent. Product state remains independent of Ink so reducers, transcript projection, and interaction ownership can be tested without a renderer.

The authoritative Session projection remains in Ink's bounded redraw region so rapid event batches cannot bypass newly appended durable rows. Locally finalized client rows pass through one stable `Static` list; React subscribes through `useSyncExternalStore` and does not mirror application state.

Durable and live events pass through one pure projection. Every model-, tool-, command-, and log-supplied display field is made terminal-safe before rendering; tool arguments and result metadata remain structured for their dedicated cards.

The human transcript renders `user/message` content only when its durable source is the user. Injected instructions, catalogs, policy snapshots, and other model-facing context remain in the session log and model request but do not appear as `You` in the terminal.

Tool cards resolve the definition visible to the active agent and call only its pure `presentCall` and `presentResult` methods. Generic, terminal, diff, read, search, and Web result intents have compact terminal views; missing, rejected, and unknown intents use safe structured fallbacks without executing content or reading files.

The controller registers one exact-agent approval answerer and the single user-question provider. Approval grants require an explicit allow-once action; abort and disposal cancel without granting. Question batches show every option and review detail and settle atomically only after the shared Service Definition validator accepts every required answer.

The runtime controller waits for complete Loader settlement, then owns one fresh or resumed root Agent. Resume discovery reads a bounded newest-first session list and resolves all visible titles in one batch.

## Input and commands

Enter submits the composer, while Ctrl+J inserts a newline. Ctrl+R opens the bounded resume selector, Escape closes the active overlay or rejects the current interaction, and approval prompts accept `y` or `n`. A question batch accepts one semicolon-separated answer per displayed question; commas select multiple labels for a multi-select question.

`/help`, `/resume`, and `/exit` belong to the terminal client. Other slash commands resolve through the effective scoped `ctx.commands` registry and write their normal durable lifecycle events. An unknown slash line stays in the composer and reaches the model only after the user submits the identical line again; a command error also preserves the draft.

Ctrl+C cancels active Agent work. A second Ctrl+C while cancellation drains requests shutdown; when idle, Ctrl+C first clears a non-empty draft and then exits from an empty composer. Shutdown rejects input, cancels pending interactions without granting them, drains and flushes the Agent, restores the terminal, disposes owned effects, and only then asks the launcher to exit. Launcher-owned fiber disposal performs the same cleanup without sending another exit request.

## Configuration

- `terminalColumnsFallback` — positive integer width used when stdout exposes no usable column count; default `80`.
- `resumeTranscriptRows` — positive count of finalized rows restored into scrollback; default `200`.
- `sessionSelectorLimit` — positive maximum number of sessions offered by the resume selector; default `50`.
- `toolOutputDisplayBudget` — positive byte budget for one rendered tool output; default `32768`.

## Model Experience

None, as this presentation package registers no prompt, tool schema, or provider-request content.

#### KV Cache effect

None; rendering and terminal input do not add or replace model request content.

## Known Limitations and Deferred Work

- **Node terminal only** — browser, Electron, and Tauri application shells are outside this package.
- **Focused keyboard interaction** — mouse input, image attachments, and alternate-screen mode are deferred; multi-question text input uses the semicolon/comma grammar documented above rather than an interactive option cursor.
- **Markdown subset** — headings, paragraphs, lists, fenced code, inline code, and visible links are supported; raw HTML is displayed as text and terminal hyperlinks are not emitted.
- **Interactive streams required** — stdin and stdout must both be TTYs; automation uses `dsh exec`.
