# Agent Note: Composer plus attaches images

Status: implemented

English | [中文](2026-08-31-composer-plus-attach.zh.md)

## Problem

The composer plus control opened the slash-command menu. Users treat plus as attach and `/` as commands. Paste and drop already added images; there was no file-dialog entry on the bar.

## Decision

Plus opens a short attach menu. `添加图片` calls the same `intakeImages` path as paste and drop; accept follows projected `imageLimits.mediaTypes`, or PNG/JPEG/WebP/GIF when that projection is absent. `看这份文档（仅本会话）` reads a local Markdown or TXT file in the browser and holds it as a composer chip; PDF, HTML, and Word set `conversation.input.attachSessionDocument.file` when the overlay occupant has reported ready, and otherwise toast that those types need the desktop runtime. `引用工作区文件（@）` toggles the `@` reference menu at the caret. `添加到知识库（制度 / Word / PDF）` increments `conversation.input.attachKnowledge.openRequest` when the desktop overlay occupant has reported ready, and otherwise toasts the library path. A `/` button keeps the existing command-menu launcher; typing `/` in the draft still opens that menu. Composer attachments stay images. Session-only document text rides the next prompt as `{ type: 'text' }` ([session extract](2026-09-01-session-document.md)).

## Alternatives considered

**Tooltip or placeholder only.** Rejected: an image-only picker never lets the user choose a PDF, so they never see a recovery hint. The plus menu names the four paths at the moment they click attach.

**Plus-only, no `/` button.** Rejected: compact, export, and the other commands would lose their only pointer entry.

**Plus opens a popover (attach vs commands).** Rejected: that is a second menu and still fights the plus-means-attach habit.

**Accept any file in the picker.** Rejected: version-one admission is raster images. A generic picker would toast every PDF. Session-only documents use their own row; durable library ingest stays on the knowledge row.

**Desktop overlay hide/replace of the official plus.** Rejected: the control lives on the shared `InputBar`; web and desktop would otherwise diverge.

## Consequences

Locked sessions disable plus. The image row disables when intake is blocked; the `@` row disables when `toggleReferenceMenu` is absent. The slash button still disables only when the session is locked or `toggleCommandMenu` is absent. Coverage is `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`, `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx`, `packages/client/ui-conversation/tests/session-document.client.spec.ts`, `packages/experimental/desktop-ask-knowledge/tests/attach-knowledge-bridge.client.spec.tsx`, and `packages/experimental/desktop-ask-knowledge/tests/attach-session-document-bridge.client.spec.tsx`.
