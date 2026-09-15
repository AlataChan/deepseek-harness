/**
 * Service Definition for commerce source import, Session binding, read-only
 * analysis, listing reads, and provider-owned export rendering.
 * @module @deepseek-ai/dsh-host-commerce
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  ChangeId as ChangeIdBrand,
  CommerceSourceId as CommerceSourceIdBrand,
  ListingId as ListingIdBrand,
} from './types.ts'
import type {} from '@deepseek-ai/dsh-session-projection'
import { commerceBindingProjectionDefinition } from './session.ts'
import type { CommerceBinding, CommerceChangeKind, CommerceDataKind, CommerceValue } from './types.ts'

export type { CommerceBinding, CommerceChangeKind, CommerceDataKind, CommerceValue } from './types.ts'
export { commerceBindingProjectionDefinition } from './session.ts'

/** Stable identity of one provider-managed commerce source. */
export type CommerceSourceId = CommerceSourceIdBrand

/**
 * Brand a string as a {@link CommerceSourceId}.
 * @param id - raw source identity.
 * @returns the same string with the commerce-source brand.
 */
export function CommerceSourceId(id: string): CommerceSourceId {
  return brandString<CommerceSourceId>(id)
}

/** Stable identity of one listing in a commerce source. */
export type ListingId = ListingIdBrand

/**
 * Brand a string as a {@link ListingId}.
 * @param id - raw listing identity.
 * @returns the same string with the listing brand.
 */
export function ListingId(id: string): ListingId {
  return brandString<ListingId>(id)
}

/** Stable identity of one staged commerce change. */
export type ChangeId = ChangeIdBrand

/**
 * Brand a string as a {@link ChangeId}.
 * @param id - raw change identity.
 * @returns the same string with the change brand.
 */
export function ChangeId(id: string): ChangeId {
  return brandString<ChangeId>(id)
}

/** Provider-neutral commerce row keyed by source column or domain field. */
export type CommerceRecord = Readonly<Record<string, CommerceValue>>

/** One source shown to operators and Consumers. */
export interface CommerceSource {
  readonly id: CommerceSourceId
  readonly displayName: string
  readonly kinds: readonly CommerceDataKind[]
}

/** Source metadata required to commit a Session binding. */
export interface CommerceSourceDescription {
  readonly displayName: string
  readonly kinds: readonly CommerceDataKind[]
}

/** Spreadsheet bytes and the provider-resolved platform mapping. */
export interface CommerceImportSpreadsheetRequest {
  readonly sourceId?: CommerceSourceId
  readonly kind: CommerceDataKind
  readonly platform: string
  readonly filename: string
  readonly bytes: Uint8Array
}

/** Preview facts for one imported commerce table. */
export interface CommerceImportTablePreview {
  readonly kind: CommerceDataKind
  readonly rowCount: number
  readonly columns: readonly string[]
}

/** Result of importing one spreadsheet table or the packaged sample. */
export interface CommerceImportPreview {
  readonly source: CommerceSource
  readonly tables: readonly CommerceImportTablePreview[]
  readonly warnings: readonly string[]
}

/** Search terms and result cap supplied by a Consumer. */
export interface CommerceSearchListingsRequest {
  readonly query?: string
  readonly limit: number
}

/** One bounded listing-search row. */
export interface CommerceListingSummary {
  readonly id: ListingId
  readonly title: string
  readonly sku?: string
  readonly status?: string
}

/** Full listing values used for reads and grounded staged changes. */
export interface CommerceListing {
  readonly id: ListingId
  readonly title: string
  readonly parentId?: ListingId
  readonly variantIds: readonly ListingId[]
  readonly values: CommerceRecord
}

/** Optional inclusive date range for a sales aggregation. */
export interface CommerceSalesSummaryRequest {
  readonly from?: string
  readonly to?: string
}

/** Aggregate sales facts returned by the provider. */
export interface CommerceSalesSummary {
  readonly orderCount: number
  readonly unitsSold: number
  readonly grossSales: number
  readonly currency: string
}

/** Inventory classification for one listing. */
export interface CommerceInventoryHealthItem {
  readonly listingId: ListingId
  readonly available: number
  readonly status: 'out-of-stock' | 'low' | 'healthy'
}

/** Bounded inventory-health result. */
export interface CommerceInventoryHealth {
  readonly items: readonly CommerceInventoryHealthItem[]
}

/** One analysis column exposed to SELECT-only queries. */
export interface CommerceAnalysisColumn {
  readonly name: string
  readonly type: string
}

/** One analysis table and its available columns. */
export interface CommerceAnalysisTable {
  readonly name: string
  readonly columns: readonly CommerceAnalysisColumn[]
}

/** Schema visible to the analysis Consumer. */
export interface CommerceAnalysisSchema {
  readonly tables: readonly CommerceAnalysisTable[]
}

/** Bounded tabular result of one analysis query. */
export interface CommerceAnalysisResult {
  readonly columns: readonly string[]
  readonly rows: readonly CommerceRecord[]
  readonly truncated: boolean
}

/** One grounded staged change supplied to {@link Commerce.renderExport}. */
export interface CommerceChange {
  readonly id: ChangeId
  readonly kind: CommerceChangeKind
  readonly listingId?: ListingId
  readonly before: CommerceRecord
  readonly after: CommerceRecord
}

/** Closed failure vocabulary of commerce Provider operations. */
export type CommerceErrorCode =
  | 'commerce-unavailable'
  | 'already-bound'
  | 'source-missing'
  | 'source-invalid'
  | 'import-invalid'
  | 'sqlite3-unavailable'
  | 'analysis-rejected'
  | 'analysis-timeout'
  | 'analysis-output-too-large'
  | 'export-invalid'

/** Typed commerce failure that Consumers can map to their own protocol. */
export class CommerceError extends Error {
  /**
   * @param code - closed business failure code.
   * @param message - operator-facing failure description.
   * @param details - optional failed rule or numeric limit.
   */
  constructor(
    readonly code: CommerceErrorCode,
    message: string,
    readonly details: { readonly ruleId?: string; readonly limit?: number } = {},
  ) {
    super(message)
    this.name = 'CommerceError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    commerce: Commerce
  }
}

/**
 * Commerce capability definition. Providers implement source I/O and analysis;
 * the concrete bind method alone commits `commerce/bound`.
 */
export abstract class Commerce extends Service {
  static inject = ['sessionProjections']

  /**
   * @param ctx - Host context that registers this service and binding projection.
   */
  constructor(ctx: Context) {
    super(ctx, 'commerce')
    ctx.sessionProjections.register(commerceBindingProjectionDefinition)
  }

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
  abstract importSpreadsheet(
    request: CommerceImportSpreadsheetRequest,
    signal?: AbortSignal,
  ): Promise<CommerceImportPreview>

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
  abstract describeSource(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceSourceDescription>

  /**
   * Bind one unbound Session after the provider verifies the source. The method
   * rechecks at the commit point so concurrent calls append only one event.
   * @param agent - live agent whose Session receives the binding event.
   * @param sourceId - source to verify and bind.
   * @param signal - caller lifetime; abort before commit appends nothing.
   * @returns the binding snapshot appended to the Session.
   */
  async bind(
    agent: Agent,
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceBinding> {
    signal?.throwIfAborted()
    this.assertUnbound(agent)
    const description = await this.describeSource(sourceId, signal)
    signal?.throwIfAborted()
    this.assertUnbound(agent)
    const binding: CommerceBinding = {
      sourceId,
      displayName: description.displayName,
      kinds: description.kinds,
    }
    return agent.session.append('commerce/bound', binding).data
  }

  private assertUnbound(agent: Agent): void {
    const binding = this.ctx.sessionProjections.stateOf(agent.session, 'commerceBinding')
    if (binding !== null) {
      throw new CommerceError(
        'already-bound',
        `session ${agent.session.id} is already bound to commerce source ${binding?.sourceId ?? 'unknown'}`,
      )
    }
  }

  /**
   * Search bounded listing summaries in one source.
   * @param sourceId - source to search.
   * @param request - optional terms and required result cap.
   * @param signal - caller lifetime; abort stops the search.
   * @returns matching listing summaries.
   */
  abstract searchListings(
    sourceId: CommerceSourceId,
    request: CommerceSearchListingsRequest,
    signal?: AbortSignal,
  ): Promise<CommerceListingSummary[]>

  /**
   * Read one complete listing for grounded edits.
   * @param sourceId - source containing the listing.
   * @param listingId - listing identity.
   * @param signal - caller lifetime; abort stops the read.
   * @returns full listing values and variant relationships.
   */
  abstract getListing(
    sourceId: CommerceSourceId,
    listingId: ListingId,
    signal?: AbortSignal,
  ): Promise<CommerceListing>

  /**
   * Aggregate sales over an optional date range.
   * @param sourceId - source containing orders.
   * @param request - optional inclusive date bounds.
   * @param signal - caller lifetime; abort stops the aggregation.
   * @returns aggregate order, unit, sales, and currency facts.
   */
  abstract salesSummary(
    sourceId: CommerceSourceId,
    request: CommerceSalesSummaryRequest,
    signal?: AbortSignal,
  ): Promise<CommerceSalesSummary>

  /**
   * Classify bounded inventory rows in one source.
   * @param sourceId - source containing inventory.
   * @param signal - caller lifetime; abort stops the read.
   * @returns inventory classifications.
   */
  abstract inventoryHealth(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceInventoryHealth>

  /**
   * Describe tables available to SELECT-only analysis.
   * @param sourceId - source whose schema is requested.
   * @param signal - caller lifetime; abort stops the schema read.
   * @returns analysis table and column metadata.
   */
  abstract analysisSchema(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisSchema>

  /**
   * Run one provider-validated SELECT-only query.
   * @param sourceId - source queried by the analysis backend.
   * @param query - SQL text subject to provider enforcement.
   * @param signal - caller lifetime; abort stops the query.
   * @returns bounded tabular query output.
   */
  abstract runAnalysisQuery(
    sourceId: CommerceSourceId,
    query: string,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisResult>

  /**
   * Render grounded staged changes in a provider-owned platform CSV format.
   * This method performs no file write.
   * @param changes - staged changes with verified before and after values.
   * @param platform - provider-resolved platform mapping identity.
   * @param signal - caller lifetime; abort stops rendering.
   * @returns complete CSV text for the Consumer to write after approval.
   */
  abstract renderExport(
    changes: readonly CommerceChange[],
    platform: string,
    signal?: AbortSignal,
  ): Promise<string>
}

export default Commerce
