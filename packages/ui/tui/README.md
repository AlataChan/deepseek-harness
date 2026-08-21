# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

`dsh-tui` is the Node-only inline terminal client. It runs inside the Host Cordis tree, renders durable session events and live agent interaction, and does not add an RPC, HTTP, WebSocket, or browser layer.

## Runtime role

The package owns terminal presentation and input lifecycle for one root agent. Product state remains independent of Ink so reducers, transcript projection, and interaction ownership can be tested without a renderer.

## Model Experience

None, as this presentation package registers no prompt, tool schema, or provider-request content.

#### KV Cache effect

None; rendering and terminal input do not add or replace model request content.

## Known Limitations and Deferred Work

- **Node terminal only** — browser, Electron, and Tauri application shells are outside this package.
- **Focused keyboard interaction** — mouse input, image attachments, and alternate-screen mode are deferred.
