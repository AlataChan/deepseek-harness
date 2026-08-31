/**
 * Service Definition for the `ctx.askData` capability seam: list data sources,
 * import a spreadsheet or the packaged sample, and bind one source to an
 * already-created Session. Providers implement storage and the data-agent
 * connection book. The Consumer (`session-controller`) only calls these
 * methods.
 * @module @deepseek-ai/dsh-host-ask-data
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AskDataBinding } from './types.ts'

export type { AskDataBinding } from './types.ts'
export { askDataBindingProjectionDefinition } from './session.ts'

/** Stable id of one overlay-managed or listed data source. */
export type AskDataSourceId = Branded<'AskDataSourceId'>

/**
 * Brand a string as an {@link AskDataSourceId}.
 * @param id - raw source id.
 * @returns the same string with the source-id brand.
 */
export function AskDataSourceId(id: string): AskDataSourceId {
  return brandString<AskDataSourceId>(id)
}

/** data-agent durable profile id written as the overlay `connectionRef`. */
export type AskDataConnectionRef = Branded<'AskDataConnectionRef'>

/**
 * Brand a string as an {@link AskDataConnectionRef}.
 * @param id - raw profile id.
 * @returns the same string with the connection-ref brand.
 */
export function AskDataConnectionRef(id: string): AskDataConnectionRef {
  return brandString<AskDataConnectionRef>(id)
}

/** How one listed row was obtained. */
export type AskDataSourceKind = 'sample' | 'import' | 'saved'

/** One row of {@link AskData.listSources}. */
export interface AskDataSource {
  readonly id: AskDataSourceId
  readonly displayName: string
  readonly kind: AskDataSourceKind
  readonly connectionRef?: AskDataConnectionRef
  readonly lastUsedAt?: string
  readonly warnings: readonly string[]
  readonly missing: boolean
}

/** One imported table as shown in preview. */
export interface AskDataTablePreview {
  readonly name: string
  readonly rowCount: number
  readonly columns: readonly string[]
}

/** Result of {@link AskData.importSpreadsheet} / {@link AskData.importSample}. */
export interface AskDataImportPreview {
  readonly source: AskDataSource
  readonly tables: readonly AskDataTablePreview[]
  readonly warnings: readonly string[]
}

/** Spreadsheet bytes plus the user-visible filename. */
export interface AskDataImportSpreadsheetRequest {
  readonly filename: string
  readonly bytes: Uint8Array
  readonly replaceSourceId?: AskDataSourceId
}

/** Bind an already-imported source to an existing Session. */
export interface AskDataBindRequest {
  readonly sourceId: AskDataSourceId
  readonly sessionId: SessionId
}

/**
 * Same-process undo of one {@link AskData.bind}. Not a Remote: it restores
 * the pre-call manifest ref / lastUsedAt, the previous data-agent session
 * binding, and deletes a profile connection this bind created.
 */
export interface AskDataBindLease {
  readonly binding: AskDataBinding
  rollback(): Promise<void>
}

/** Closed failure vocabulary of the ask-data primitives. */
export type AskDataErrorCode =
  | 'ask-data-unavailable'
  | 'source-missing'
  | 'source-invalid'
  | 'sqlite3-missing'
  | 'csv-encoding'
  | 'file-too-large'
  | 'too-many-rows'
  | 'decoded-cell-budget'
  | 'extension-rejected'
  | 'bind-failed'

/** Typed failure thrown by the seam so consumers can map wire codes. */
export class AskDataError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   * @param details - optional rule id or numeric limit.
   */
  constructor(
    readonly code: AskDataErrorCode,
    message: string,
    readonly details: { readonly ruleId?: string; readonly limit?: number } = {},
  ) {
    super(message)
    this.name = 'AskDataError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    askData: AskData
  }
}

/**
 * Abstract data-source listing, import, and session bind. Subclass, implement
 * the four methods, and load the subclass as a plugin — it registers as
 * `ctx.askData`. The class itself is not a mounted plugin.
 */
export abstract class AskData extends Service {
  /**
   * @param ctx - Host context that registers this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'askData')
  }

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
  abstract importSpreadsheet(
    request: AskDataImportSpreadsheetRequest,
    signal?: AbortSignal,
  ): Promise<AskDataImportPreview>

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
}

export default AskData
