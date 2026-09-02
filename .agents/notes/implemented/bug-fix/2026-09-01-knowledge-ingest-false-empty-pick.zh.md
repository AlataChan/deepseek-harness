# Agent Note: 知识库入库假空选与 apply 拒写

Status: implemented

[English](2026-09-01-knowledge-ingest-false-empty-pick.md) | 中文

## Problem

上传 `.docx` 会同时出现「正在写入知识库」和「没有读到所选文件」。再打开选择器仍是原来的户口本行，看起来像入库完成。Word 正文已经在 vault `raw/`，但 wiki INDEX 仍空，apply 留下 `schema.page_meta_invalid` 拒写。

## Decision

覆盖选文件控件会同时触发 `change` 和 `input`。已经拿到 File 之后，清空 `value` 不得 toast 空选。`bindNativeFileChange` 同一条规则。Host `finishIngest` 在 sidecar `validate-apply` 之前，把 page-meta 不收的 `create_page` `type` / `role`（`wiki` 改成 `note`）改掉。sidecar `status` 以 `rejected` 开头时，入库是 `failed`，不是 `applied`。

## Alternatives considered

**每次空 FileList 都报空选。** 否决：WebKit 在控件清掉已选 File 时也会给出空列表。

**重建 kb-runtime 去改非法枚举。** 否决：打包复用冻结 sidecar；Host 改写对 apply 足够。

## Consequences

真选到 File 时，入库进行中不再看起来像没读到。户口本行不再被当成 wiki 已成功。覆盖为 `packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`、`packages/client/ui-conversation/tests/session-document.client.spec.ts`、`packages/experimental/desktop-ask-knowledge/tests/proposal-page-meta.spec.ts` 与 `packages/experimental/desktop-ask-knowledge/tests/ingest.spec.ts`。
