# Agent Note: Knowledge ingest accepts Word

Status: implemented

English | [中文](2026-09-01-knowledge-ingest-docx.zh.md)

## Problem

「看这份文档」already unzipped `.docx` on the Host. Knowledge ingest still rejected the same suffix at `ACCEPTED_INGEST_EXTENSIONS`, so the picker toasted 「这种文件还不能入库」and `beginIngest` returned `type-unsupported`. Users who can extract Word cannot thicken a library with it.

## Decision

`beginIngest` accepts `.docx` on both Host `upload-temp` and Client `ingest-file` lists. After `materializeUpload`, `writeDocxMarkdownForIngest` unzips `word/document.xml` with the same Host helper as session extract, writes `{stem}.md` next to the zip, and `finishIngestPipeline` passes that markdown to sidecar `ingest-file`. Empty extract fails as `这份 Word 没有可提取的文字`. Frozen sidecar never sees the zip. The Client factory still does not import `fflate`. Legacy `.doc` stays rejected. Session extract is unchanged ([session document](../feature/2026-09-01-session-document.md)).

## Alternatives considered

**Sidecar markitdown / DocxConverter.** Rejected: the frozen `REUSE_KB_RUNTIME=1` onedir has the converter name but not `mammoth`, so Word convert fails in the shipped runtime.

**Import `fflate` on the Client.** Rejected: tsdown inlines `require("module")` into `lib/client.js` and the factory cannot load the overlay.

**Rebuild the sidecar with mammoth.** Rejected: desktop packaging reuses the frozen kb-runtime; Host unzip already covers the product path.

## Consequences

A library upload of `.docx` writes vault `raw/{stem}.md`. Sidecar `source_file` is that markdown name. Headers, footers, and comments outside `word/document.xml` are omitted. `scripts/verify-desktop-bundle.sh` requires Host and Client ingest lists to include `.docx`, and still forbids `require("module")` in the Client factory. Coverage is `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts`, `packages/experimental/desktop-ask-knowledge/tests/extract-docx.spec.ts`, and `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`.
