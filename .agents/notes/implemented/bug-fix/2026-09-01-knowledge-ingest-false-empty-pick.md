# Agent Note: Knowledge ingest false empty-pick and rejected apply

Status: implemented

English | [中文](2026-09-01-knowledge-ingest-false-empty-pick.zh.md)

## Problem

Uploading a `.docx` showed 「正在写入知识库」and 「没有读到所选文件」at once. Reopening the picker listed the same catalog rows, so ingest looked finished. The Word body was in vault `raw/`, but wiki INDEX stayed empty and apply had written `schema.page_meta_invalid` rejections.

## Decision

`change` and `input` both fire on the overlay file control. After a File is taken, clearing `value` must not toast empty-pick. `bindNativeFileChange` uses the same rule. Host `finishIngest` rewrites `create_page` `type` / `role` values that page-meta rejects (`wiki` becomes `note`) before sidecar `validate-apply`. A sidecar `status` that starts with `rejected` is ingest `failed`, not `applied`.

## Alternatives considered

**Keep empty-pick on every empty FileList.** Rejected: WebKit emits that list when the control clears itself after a real File.

**Rebuild kb-runtime to fill invalid enums.** Rejected: packaging reuses the frozen sidecar; Host rewrite is enough for apply.

## Consequences

A real File no longer looks unread while ingest runs. Catalog rows are not treated as wiki success. Coverage is `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`, `packages/client/ui-conversation/tests/session-document.client.spec.ts`, `packages/experimental/desktop-ask-knowledge/tests/proposal-page-meta.spec.ts`, and `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts`.
