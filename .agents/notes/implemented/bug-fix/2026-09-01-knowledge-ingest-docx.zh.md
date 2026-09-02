# Agent Note: 知识库入库接受 Word

Status: implemented

[English](2026-09-01-knowledge-ingest-docx.md) | 中文

## Problem

「看这份文档」已经能在 Host 上解 `.docx`。知识库入库仍在 `ACCEPTED_INGEST_EXTENSIONS` 拒同一后缀，选择器 toast「这种文件还不能入库」，`beginIngest` 返回 `type-unsupported`。能抽出 Word 的用户不能把它写进会变厚的库。

## Decision

`beginIngest` 在 Host `upload-temp` 和 Client `ingest-file` 两份名单都收 `.docx`。`materializeUpload` 之后，`writeDocxMarkdownForIngest` 用与仅本会话相同的 Host 助手解 `word/document.xml`，在 zip 旁边写出 `{stem}.md`，`finishIngestPipeline` 把这份 markdown 交给 sidecar `ingest-file`。抽空失败为「这份 Word 没有可提取的文字」。冻结 sidecar 看不到 zip。Client 工厂仍不引进 `fflate`。老 `.doc` 仍拒。仅本会话抽取不变（[会话文档](../feature/2026-09-01-session-document.zh.md)）。

## Alternatives considered

**走 sidecar markitdown / DocxConverter。** 否决：冻结的 `REUSE_KB_RUNTIME=1` onedir 有转换器名但没有 `mammoth`，发货运行时转 Word 会失败。

**在 Client 引进 `fflate`。** 否决：tsdown 会把 `require("module")` 打进 `lib/client.js`，工厂加载不了 overlay。

**重建带 mammoth 的 sidecar。** 否决：桌面打包复用冻结 kb-runtime；Host 解压已经覆盖产品路径。

## Consequences

知识库上传 `.docx` 会写入 vault `raw/{stem}.md`。sidecar 的 `source_file` 是这份 markdown 名。`word/document.xml` 以外的页眉、页脚、批注不会抽出。`scripts/verify-desktop-bundle.sh` 要求 Host 和 Client 入库名单含 `.docx`，并继续禁止 Client 工厂出现 `require("module")`。覆盖为 `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/extract-docx.spec.ts` 与 `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`。
