# 问数接缝

[English](ask-data.md) | 中文

由 [`@deepseek-ai/dsh-host-ask-data`](../../packages/host/ask-data/README.zh.md) 拥有的关系型数据接缝。它列出已配置的数据源、把电子表格导入其中一个,并把数据源绑定到一个 Session。Session Controller 通过其 `askData` Remote 暴露它;桌面外挂通过[数据代理 Session 流程](../../packages/experimental/desktop-ask-data/README.zh.md)消费它。

来源：[`packages/host/ask-data/src/index.ts`](../../packages/host/ask-data/src/index.ts)

## 持久事件

每个绑定都是 log-only：消费方通过该包的 Session 投影重建当前绑定，而不是回放 payload。

- `ask-data/bound`

`ask-data/*` 域属于本接缝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaskdata--askdata-abstract-seam"></a>

### `ctx.askData` — `AskData` (abstract seam)

Abstract data-source listing, import, and session bind. Subclass, implement the four methods, and load the subclass as a plugin — it registers as `ctx.askData`. The class itself is not a mounted plugin.

```ts cordis-catalog
/**
 * List overlay-managed sources plus unmatched data-agent connections.
 * @param signal - caller lifetime; abort stops the listing.
 * @returns listed sources, `missing` set when a managed sqlite vanished.
 */
abstract listSources(signal?: AbortSignal): Promise<AskDataSource[]>

/**
 * Import one `.xlsx` / `.csv` into a managed sqlite and manifest row.
 * Does not apply a preset or open a session. `connectionRef` stays absent.
 * @param request - filename, decoded bytes, optional replace target.
 * @param signal - caller lifetime; abort stops the import.
 * @returns preview read from the written sqlite.
 */
abstract importSpreadsheet( request: AskDataImportSpreadsheetRequest, signal?: AbortSignal, ): Promise<AskDataImportPreview>

/**
 * Copy the packaged sample sqlite into the manifest. Does not need host
 * `sqlite3`. Does not apply a preset or open a session.
 * @param signal - caller lifetime; abort stops the copy.
 * @returns preview read from the copied sqlite.
 */
abstract importSample(signal?: AbortSignal): Promise<AskDataImportPreview>

/**
 * Register or reuse the readonly data-agent profile, write overlay
 * `connectionRef`, and persist the session binding. The Session must
 * already exist. Idempotent for the same `{ sourceId, sessionId }`.
 * @param request - source and session identities.
 * @param signal - caller lifetime; abort stops the bind.
 * @returns a lease whose `rollback` undoes this bind in-process.
 */
abstract bind(request: AskDataBindRequest, signal?: AbortSignal): Promise<AskDataBindLease>
```

Source: [`packages/host/ask-data/src/index.ts`](../../packages/host/ask-data/src/index.ts)
<!-- END GENERATED cordis-surface -->
