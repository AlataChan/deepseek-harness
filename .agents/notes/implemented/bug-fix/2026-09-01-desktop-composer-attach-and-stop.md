# Agent Note: Desktop composer attach next-step and Stop

Status: implemented

English | [中文](2026-09-01-desktop-composer-attach-and-stop.zh.md)

## Problem

The composer plus menu called `HTMLInputElement.click()` on a clipped or `display:none` file input from a portaled `Menu` row. Tauri 2 WebView ignores that programmatic click, and a later `<label htmlFor>` over a 1px clipped input still does not open the native picker, so 「添加图片」and 「看这份文档」showed a hint bar and no file in the composer. 「引用工作区文件（@）」opened the mention menu, which auto-closes when the workspace has no files. 「添加到知识库」opened the library list; Create then used the same ignored picker, so users never reached a file. Framing a session document into the visible draft hid the attachment preview users get from pasted images, and the model still had to search the workspace. Stop routed through `sessions.scope(id).get('conversation').cancel()`, then through `sessions.binding(sessionId)?.session.cancel()`. A Host remote-event reply posts `$events/result`; the companion gateway encoded `$` as `%24`, Connection returned HTTP 404, and that throw tore down the IPC channel so `session/cancel` failed with the same 404.

## Decision

Plus-menu image and session-document rows keep a visible choose control whose click target is an `opacity: 0.01` file input covering the button (`inset: 0`, `font-size: 100px`). They do not rely on `click()` or on `label[htmlFor]` plus a clipped input. Session-document and knowledge-library inputs omit HTML `accept`; WebKit otherwise closes the dialog without a File when the UTI or MIME does not match `.md`. The listener is bound on the element (`change` / `input`), not React root delegation. An empty FileList after a completed pick toasts so the miss is visible. Markdown and TXT use `File.text()` with a FileReader fallback. A chosen image stays on the attachment rail. A chosen session document is held as a composer chip (filename, remove) and is framed into the sent `{ type: 'text' }` on Submit, not written into the visible draft. Flush returns that framed text and `submit` uses it, because the editor projection can still hold the typed draft in the same tick. Word is unzipped on the Host from `word/document.xml`. The Client factory must not `require("module")`. A chip alone is a sendable draft. The @ row keeps the workspace mention menu and shows a hint when that list vanishes. The plus-menu knowledge occupant opens `LibraryPicker` on the upload panel. Create and Add document switch to that panel; choose-file is the same overlay input. The hero chip still opens the library list. Stop calls `sessions.binding(sessionId)?.session.cancel()`. The companion `acceptRpc` path joins legal Connection segments literally, so `$events/result` stays `/api/$events/result`. A non-2xx Connection fetch returns a failed `server-response` and leaves the channel open. Remote failures still land in `promptError`. Ordinary running sessions keep an independent Stop beside Send when the draft is sendable. Official `desktop-app` is unchanged.

## Alternatives considered

**Tauri native file dialog.** Rejected: `apps/desktop` must not grow product logic, and the desktop README keeps browser pickers.

**Expand image attachment or a new ContentBlock for session documents.** Rejected: session-only text already travels in `user/message` `{ type: 'text' }`.

**Keep Stop only on the empty-draft primary.** Rejected: extracting a document fills a sendable chip and hid cancellation. See [running-draft primary Send](2026-08-20-running-draft-primary-send.md).

**Encode every RPC path segment with `encodeURIComponent`.** Rejected: `$` is legal in Connection's `ENDPOINT_SEGMENT_PATTERN`. Encoding it 404s `$events/result` and takes down the gateway.

## Consequences

Users get a choose-file control they can actually click after plus-menu image, session-document, and knowledge picks. A session-only file appears as a composer chip like a pasted image and is sent as framed text. @ still mentions workspace files and explains an empty list. Stop reaches the Host abort without a composer exception or a `$events/result` 404 tearing down the companion. Coverage is `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`, `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx`, `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`, `packages/experimental/desktop-ask-knowledge/tests/apply.client.spec.ts`, and `packages/client/connection-process/tests/host-gateway.host.spec.ts`.
