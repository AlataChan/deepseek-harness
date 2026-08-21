# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

`dsh-tui` is the Node-only inline terminal client. It runs inside the Host Cordis tree, renders durable session events and live agent interaction, and does not add an RPC, HTTP, WebSocket, or browser layer.

## Runtime role

The package owns terminal presentation and input lifecycle for one root agent. Product state remains independent of Ink so reducers, transcript projection, and interaction ownership can be tested without a renderer.

Finalized rows pass through one stable Ink `Static` list into ordinary shell scrollback. Only live assistant output, runtime status, the store-owned composer, and the active overlay remain in the redraw region; React subscribes through `useSyncExternalStore` and does not mirror application state.

Durable and live events pass through one pure projection. Every model-, tool-, command-, and log-supplied display field is made terminal-safe before rendering; tool arguments and result metadata remain structured for their dedicated cards.

Tool cards resolve the definition visible to the active agent and call only its pure `presentCall` and `presentResult` methods. Generic, terminal, diff, read, search, and Web result intents have compact terminal views; missing, rejected, and unknown intents use safe structured fallbacks without executing content or reading files.

The controller registers one exact-agent approval answerer and the single user-question provider. Approval grants require an explicit allow-once action; abort and disposal cancel without granting. Question batches show every option and review detail and settle atomically only after the shared Service Definition validator accepts every required answer.

The runtime controller waits for complete Loader settlement, then owns one fresh or resumed root Agent. Resume discovery reads a bounded newest-first session list and resolves all visible titles in one batch.

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
- **Focused keyboard interaction** — mouse input, image attachments, and alternate-screen mode are deferred.
- **Markdown subset** — headings, paragraphs, lists, fenced code, inline code, and visible links are supported; raw HTML is displayed as text and terminal hyperlinks are not emitted.
- **Interactive streams required** — stdin and stdout must both be TTYs; automation uses `dsh exec`.
