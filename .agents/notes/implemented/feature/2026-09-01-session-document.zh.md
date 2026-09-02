# Agent Note: Session-only document extract

Status: implemented

[English](2026-09-01-session-document.md) | 中文

## Problem

知识库入库会加厚 `catalog.json` 和 vault，让以后的会话还能检索。用户也需要只把一份本地文档给模型看这一次。复用入库会写户口本。正文只放在 Client 草稿里，会话日志就看不见。

## Decision

加号菜单有「看这份文档（仅本会话）」。Markdown 和 TXT 在浏览器里用 `File.text()` 读出（失败则 FileReader），放在 composer 芯片上。选文件控件不设 HTML `accept`。PDF 和 HTML 走 `ctx.askKnowledge` 的 `beginExtract` / `appendExtractChunk` / `finishExtract`，再跑 sidecar `convert-file`。Word（`.docx`）走同一套 extract remotes，由 Host 解 `word/document.xml`；Client 包不引进 `fflate`。知识库入库用同一套解压，再把 markdown 交给 sidecar `ingest-file`（[入库 Word](../bug-fix/2026-09-01-knowledge-ingest-docx.zh.md)）。已经拿到 File 之后，清空选文件控件不再 toast 空选（[假空选](../bug-fix/2026-09-01-knowledge-ingest-false-empty-pick.zh.md)）。发送时把正文框成 `<session-document filename="…">…</session-document>`，上限是 `ASK_KNOWLEDGE_EXTRACT_MAX_CHARS`（32 000 个码点），写入已有的 `{ type: 'text' }`。flush 把这段框文本交给 `submit`，sink 不等更晚的编辑器投影。芯片不写进可见草稿。extract 不写 `catalog.json`，不写 vault `raw/`，也不跑 propose 或 apply。表格 toast 导向问数。抽空失败；扫描件 PDF 失败为「这份 PDF 没有可提取的文字。扫描件还不能作为会话附件。」。`session/finishAskKnowledgeExtract` 等 90 秒。官方图片 admission 不变。

## Alternatives considered

**复用 `finishIngest`、跳过 apply。** 否决：入库仍会写 vault 和户口本，桌面 unary 仍会跑 propose。

**新 `ContentBlock` 或扩图片附件。** 否决：官方 composer 附件仍只收栅格图。仅本会话正文走已有的 user-message 文本块。

**只放 Client 草稿，不进 `prompt()`。** 否决：模型可见输入必须能从会话日志还原。

**会话抽取做 OCR。** v1 否决：与入库同一套文字转换。失败要响。

## Consequences

没有 overlay 的 Web 能贴 Markdown 和 TXT，并对 PDF/HTML toast「需要桌面运行时」。桌面 overlay 占据 `conversation.input.attachSessionDocument`。覆盖为 `packages/client/ui-conversation/tests/session-document.client.spec.ts`、`packages/client/ui-conversation/tests/input-bar.client.spec.tsx`、`packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/extract.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/extract-file.client.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/extract-docx.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/attach-session-document-bridge.client.spec.tsx`、`packages/api/session-controller/tests/session-ask-knowledge.host.spec.ts` 与 `packages/client/connection-process/tests/process-transport.client.spec.ts`。
