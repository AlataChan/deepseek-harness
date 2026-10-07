# 商务接缝

[English](commerce.md) | 中文

由 [`@deepseek-ai/dsh-host-commerce`](../../packages/host/commerce/README.zh.md) 拥有的商务数据接缝。它列出已配置的店铺数据源、导入电子表格导出、在 `commerce` preset 上把数据源绑定到 Session,并对导入的表执行读取与分析查询。暂存改动只以获批导出的形式离开。

来源：[`packages/host/commerce/src/index.ts`](../../packages/host/commerce/src/index.ts)

## 持久事件

每个绑定都是 log-only：消费方通过该包的 Session 投影重建当前绑定，而不是回放 payload。

- `commerce/bound`

`commerce/*` 域属于本接缝。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcommerce--commerce-abstract-seam"></a>

### `ctx.commerce` — `Commerce` (abstract seam)

Commerce capability definition. Providers implement source I/O and analysis; the concrete bind method alone commits `commerce/bound`.

```ts cordis-catalog
/**
 * List provider-managed commerce sources.
 * @param signal - caller lifetime; abort stops the listing.
 * @returns available commerce sources.
 */
abstract listSources(signal?: AbortSignal): Promise<CommerceSource[]>

/**
 * List the platform mapping ids this provider accepts for imports and exports.
 * @returns non-empty platform ids in configuration order.
 */
abstract platforms(): readonly string[]

/**
 * Import or replace one table through a provider-owned platform mapping.
 * @param request - optional target source, table family, platform, filename, and bytes.
 * @param signal - caller lifetime; abort stops the import.
 * @returns preview of the imported table and resulting source.
 */
abstract importSpreadsheet( request: CommerceImportSpreadsheetRequest, signal?: AbortSignal, ): Promise<CommerceImportPreview>

/**
 * Import the provider's packaged fictional sample source.
 * @param signal - caller lifetime; abort stops the import.
 * @returns preview of the imported sample.
 */
abstract importSample(signal?: AbortSignal): Promise<CommerceImportPreview>

/**
 * Read source metadata and fail with `source-missing` for an unknown identity.
 * @param sourceId - provider-managed source identity.
 * @param signal - caller lifetime; abort stops the read.
 * @returns source display name and imported table families.
 */
abstract describeSource( sourceId: CommerceSourceId, signal?: AbortSignal, ): Promise<CommerceSourceDescription>

/**
 * Bind one unbound Session after the provider verifies the source. The method
 * rechecks at the commit point so concurrent calls append only one event.
 * @param agent - live agent whose Session receives the binding event.
 * @param sourceId - source to verify and bind.
 * @param signal - caller lifetime; abort before commit appends nothing.
 * @returns the binding snapshot appended to the Session.
 */
async bind( agent: Agent, sourceId: CommerceSourceId, signal?: AbortSignal, ): Promise<CommerceBinding>

/**
 * Search bounded listing summaries in one source.
 * @param sourceId - source to search.
 * @param request - optional terms and required result cap.
 * @param signal - caller lifetime; abort stops the search.
 * @returns matching listing summaries.
 */
abstract searchListings( sourceId: CommerceSourceId, request: CommerceSearchListingsRequest, signal?: AbortSignal, ): Promise<CommerceListingSummary[]>

/**
 * Read one complete listing for grounded edits.
 * @param sourceId - source containing the listing.
 * @param listingId - listing identity.
 * @param signal - caller lifetime; abort stops the read.
 * @returns full listing values and variant relationships.
 */
abstract getListing( sourceId: CommerceSourceId, listingId: ListingId, signal?: AbortSignal, ): Promise<CommerceListing>

/**
 * Aggregate sales over an optional date range.
 * @param sourceId - source containing orders.
 * @param request - optional inclusive date bounds.
 * @param signal - caller lifetime; abort stops the aggregation.
 * @returns aggregate order, unit, sales, and currency facts.
 */
abstract salesSummary( sourceId: CommerceSourceId, request: CommerceSalesSummaryRequest, signal?: AbortSignal, ): Promise<CommerceSalesSummary>

/**
 * Classify bounded inventory rows in one source.
 * @param sourceId - source containing inventory.
 * @param signal - caller lifetime; abort stops the read.
 * @returns inventory classifications.
 */
abstract inventoryHealth( sourceId: CommerceSourceId, signal?: AbortSignal, ): Promise<CommerceInventoryHealth>

/**
 * Describe tables available to SELECT-only analysis.
 * @param sourceId - source whose schema is requested.
 * @param signal - caller lifetime; abort stops the schema read.
 * @returns analysis table and column metadata.
 */
abstract analysisSchema( sourceId: CommerceSourceId, signal?: AbortSignal, ): Promise<CommerceAnalysisSchema>

/**
 * Run one provider-validated SELECT-only query.
 * @param sourceId - source queried by the analysis backend.
 * @param query - SQL text subject to provider enforcement.
 * @param signal - caller lifetime; abort stops the query.
 * @returns bounded tabular query output.
 */
abstract runAnalysisQuery( sourceId: CommerceSourceId, query: string, signal?: AbortSignal, ): Promise<CommerceAnalysisResult>

/**
 * Render grounded staged changes in a provider-owned platform CSV format.
 * This method performs no file write.
 * @param changes - staged changes with verified before and after values.
 * @param platform - provider-resolved platform mapping identity.
 * @param signal - caller lifetime; abort stops rendering.
 * @returns complete CSV text for the Consumer to write after approval.
 */
abstract renderExport( changes: readonly CommerceChange[], platform: string, signal?: AbortSignal, ): Promise<string>
```

Types: [Agent](core.zh.md)

Source: [`packages/host/commerce/src/index.ts`](../../packages/host/commerce/src/index.ts)
<!-- END GENERATED cordis-surface -->
