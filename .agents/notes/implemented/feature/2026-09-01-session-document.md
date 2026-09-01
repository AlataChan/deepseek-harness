# Agent Note: Session-only document extract

Status: implemented

English | [中文](2026-09-01-session-document.zh.md)

## Problem

Knowledge ingest thickens `catalog.json` and the vault so later sessions can retrieve. Users also need to show one local document to the model for this chat only. Reusing ingest would write a library row. Putting the body only in Client draft state would hide it from the session log.

## Decision

The composer plus menu has `看这份文档（仅本会话）`. Markdown and TXT are read in the browser with `File.text()` and framed into the draft. PDF and HTML go through `beginExtract` / `appendExtractChunk` / `finishExtract` on `ctx.askKnowledge`, then sidecar `convert-file`. The framed body is `<session-document filename="…">…</session-document>`, capped at `ASK_KNOWLEDGE_EXTRACT_MAX_CHARS` (32 000 code points). The next `session.prompt` sends that text as an existing `{ type: 'text' }` block. Extract does not write `catalog.json`, does not write vault `raw/`, and does not run propose or apply. Spreadsheets toast toward 问数. An empty conversion fails; a scanned PDF fails as `这份 PDF 没有可提取的文字。扫描件还不能作为会话附件。`. `session/finishAskKnowledgeExtract` waits 90s. Official image admission is unchanged.

## Alternatives considered

**Reuse `finishIngest` and skip apply.** Rejected: ingest still writes vault and catalog, and the desktop unary still runs propose.

**New `ContentBlock` or image-attachment expansion.** Rejected: official composer attachments stay raster images. Session-document text rides the existing user-message text block.

**Client-only draft state, never `prompt()`.** Rejected: model-visible input must be reconstructable from the session log.

**OCR scanned pages for session extract.** Rejected for v1: the same text converters as ingest. Failure is loud.

## Consequences

Web without the overlay can paste Markdown and TXT and toasts that PDF/HTML need the desktop runtime. Desktop overlay occupies `conversation.input.attachSessionDocument`. Coverage is `packages/client/ui-conversation/tests/session-document.client.spec.ts`, `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`, `packages/experimental/desktop-ask-knowledge/tests/extract.spec.ts`, `packages/experimental/desktop-ask-knowledge/tests/extract-file.client.spec.ts`, `packages/experimental/desktop-ask-knowledge/tests/attach-session-document-bridge.client.spec.tsx`, `packages/api/session-controller/tests/session-ask-knowledge.host.spec.ts`, and `packages/client/connection-process/tests/process-transport.client.spec.ts`.
