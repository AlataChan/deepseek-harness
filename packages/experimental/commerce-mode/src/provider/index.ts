/**
 * File-backed implementation of `ctx.commerce` over fixed SQLite tables.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/provider
 */

import { randomUUID } from 'node:crypto'
import { chmod, link, mkdir, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import {
  MAX_DECODED_CELL_BYTES,
  MAX_TOTAL_ROWS,
  parseSpreadsheet,
  quoteIdent,
  writeSqliteFile,
  type ImportedTable,
} from '@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet'
import {
  Commerce,
  CommerceError,
  ListingId,
  type CommerceAnalysisResult,
  type CommerceAnalysisSchema,
  type CommerceChange,
  type CommerceDataKind,
  type CommerceImportPreview,
  type CommerceImportSpreadsheetRequest,
  type CommerceInventoryHealth,
  type CommerceListing,
  type CommerceListingSummary,
  type CommerceSalesSummary,
  type CommerceSalesSummaryRequest,
  type CommerceSearchListingsRequest,
  type CommerceSource,
  type CommerceSourceDescription,
  type CommerceSourceId,
  type CommerceValue,
} from '@deepseek-ai/dsh-host-commerce'
import {
  assertAnalysisDatabasePath,
  executeAnalysisQuery,
  probeSqliteSafety,
  validateAnalysisQuery,
  type AnalysisLimits,
} from './analysis.ts'
import { renderChangesCsv } from './export.ts'
import {
  COMMERCE_MANIFEST_VERSION,
  commerceManifestPath,
  newCommerceSourceId,
  publicSource,
  readCommerceManifest,
  sourceDatabasePath,
  validateSourceId,
  writeCommerceManifest,
  type CommerceManifest,
  type StoredCommerceSource,
} from './manifest.ts'
import type { ColumnMapping, Config, PlatformConfig } from './types.ts'
import { readPackagedSample } from '../assets.ts'

export type { AnalysisConfig, ColumnMapping, Config, PlatformConfig } from './types.ts'

const FIXED_COLUMNS = {
  orders: ['order_id', 'listing_id', 'quantity', 'gross_sales', 'currency', 'ordered_at'],
  products: ['listing_id', 'title', 'sku', 'status', 'parent_id'],
  inventory: ['listing_id', 'available', 'low_stock_threshold'],
} as const satisfies Record<CommerceDataKind, readonly string[]>

const REQUIRED_COLUMNS = {
  orders: ['order_id', 'listing_id', 'quantity', 'gross_sales'],
  products: ['listing_id', 'title'],
  inventory: ['listing_id', 'available'],
} as const satisfies Record<CommerceDataKind, readonly string[]>

/** Owner-only modes for the source root, a database being published, and a committed database. */
const SOURCES_ROOT_MODE = 0o700
const WRITABLE_SOURCE_MODE = 0o600
const COMMITTED_SOURCE_MODE = 0o400

const SAMPLE_FILES = [
  ['products', 'products.csv'],
  ['orders', 'orders.csv'],
  ['inventory', 'inventory.csv'],
] as const
const SAMPLE_DISPLAY_NAME = 'Fictional tea shop'

/** File-backed commerce source Provider. */
export default class CommerceMode extends Commerce {
  private sqlite3 = ''
  private mutationChain: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Host context carrying projections and managed subprocesses.
   * @param config - validated source root, platform mappings, and analysis limits.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (!isAbsolute(config.sourcesRoot)) {
      throw new Error('commerce-mode: sourcesRoot must be an absolute path')
    }
    if (!Object.hasOwn(config.platforms, 'sample')) {
      throw new Error("commerce-mode: platforms must include the 'sample' mapping used by the packaged sample import")
    }
  }

  protected async [Service.init](): Promise<void> {
    await mkdir(this.config.sourcesRoot, { recursive: true, mode: SOURCES_ROOT_MODE })
    // An existing root is narrowed too, so merchant exports stay private to the Host user.
    await chmod(this.config.sourcesRoot, SOURCES_ROOT_MODE)
    const requested = this.config.sqlite3Path === undefined || this.config.sqlite3Path === ''
      ? 'sqlite3'
      : this.config.sqlite3Path
    try {
      this.sqlite3 = await this.ctx.subprocess.resolveExecutable(requested)
    } catch (cause: unknown) {
      throw new CommerceError('sqlite3-unavailable', `commerce-mode cannot resolve sqlite3: ${errorMessage(cause)}`, {
        ruleId: 'sqlite3-path',
      })
    }
    await probeSqliteSafety(this.ctx, this.sqlite3, this.config.analysis.graceMs)
  }

  override platforms(): readonly string[] {
    return Object.keys(this.config.platforms)
  }

  override async listSources(signal?: AbortSignal): Promise<CommerceSource[]> {
    signal?.throwIfAborted()
    const manifest = await this.readManifest()
    return manifest.sources.map(publicSource)
  }

  override importSpreadsheet(
    request: CommerceImportSpreadsheetRequest,
    signal?: AbortSignal,
  ): Promise<CommerceImportPreview> {
    return this.mutate(async () => {
      signal?.throwIfAborted()
      const { imported, warnings } = await this.decodeTable(
        request.kind, request.platform, request.filename, request.bytes, signal,
      )
      const manifest = await this.readManifest()
      const existing = request.sourceId === undefined
        ? undefined
        : this.requireSource(manifest, request.sourceId)
      const id = existing?.id ?? newCommerceSourceId()
      const database = sourceDatabasePath(this.config.sourcesRoot, id)
      const tables = existing === undefined
        ? [imported]
        : await this.replaceTable(database, existing.kinds, imported, signal)
      const kinds = orderedKinds([...existing?.kinds ?? [], request.kind])
      const stored: StoredCommerceSource = {
        id,
        displayName: existing?.displayName ?? basename(request.filename),
        kinds,
        warnings: [...new Set([...(existing?.warnings ?? []), ...warnings])],
      }
      const sources = existing === undefined
        ? [...manifest.sources, stored]
        : manifest.sources.map(source => source.id === id ? stored : source)
      await this.commitSource(database, existing !== undefined, tables, {
        version: COMMERCE_MANIFEST_VERSION,
        sources,
      }, signal)
      return {
        source: publicSource(stored),
        tables: [{ kind: request.kind, rowCount: imported.rows.length, columns: imported.columns }],
        warnings: [...warnings],
      }
    })
  }

  override importSample(signal?: AbortSignal): Promise<CommerceImportPreview> {
    return this.mutate(async () => {
      signal?.throwIfAborted()
      const decoded: Array<{ kind: CommerceDataKind; imported: ImportedTable; warnings: readonly string[] }> = []
      for (const [kind, filename] of SAMPLE_FILES) {
        const table = await this.decodeTable(kind, 'sample', filename, await readPackagedSample(filename), signal)
        decoded.push({ kind, ...table })
      }
      const manifest = await this.readManifest()
      const stored: StoredCommerceSource = {
        id: newCommerceSourceId(),
        displayName: SAMPLE_DISPLAY_NAME,
        kinds: orderedKinds(decoded.map(table => table.kind)),
        warnings: [...new Set(decoded.flatMap(table => table.warnings))],
      }
      await this.commitSource(
        sourceDatabasePath(this.config.sourcesRoot, stored.id),
        false,
        decoded.map(table => table.imported),
        { version: COMMERCE_MANIFEST_VERSION, sources: [...manifest.sources, stored] },
        signal,
      )
      return {
        source: publicSource(stored),
        tables: decoded.map(table => ({
          kind: table.kind, rowCount: table.imported.rows.length, columns: table.imported.columns,
        })),
        warnings: stored.warnings,
      }
    })
  }

  override async describeSource(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceSourceDescription> {
    signal?.throwIfAborted()
    const source = this.requireSource(await this.readManifest(), sourceId)
    await assertAnalysisDatabasePath(this.config.sourcesRoot, sourceDatabasePath(this.config.sourcesRoot, source.id))
    return { displayName: source.displayName, kinds: source.kinds }
  }

  override async searchListings(
    sourceId: CommerceSourceId,
    request: CommerceSearchListingsRequest,
    signal?: AbortSignal,
  ): Promise<CommerceListingSummary[]> {
    const where = request.query === undefined || request.query === ''
      ? ''
      : ` WHERE title LIKE ${sqlText(`%${request.query}%`)} ESCAPE '\\' OR sku LIKE ${sqlText(`%${request.query}%`)} ESCAPE '\\'`
    const limit = Math.max(0, Math.trunc(request.limit))
    const result = await this.fixedQuery(sourceId,
      `SELECT listing_id, title, sku, status FROM products${where} ORDER BY listing_id LIMIT ${String(limit)}`,
      signal)
    return result.rows.map(row => ({
      id: ListingId(String(row.listing_id ?? '')),
      title: String(row.title ?? ''),
      ...optionalText('sku', row.sku),
      ...optionalText('status', row.status),
    }))
  }

  override async getListing(
    sourceId: CommerceSourceId,
    listingId: ListingId,
    signal?: AbortSignal,
  ): Promise<CommerceListing> {
    const row = (await this.fixedQuery(sourceId,
      `SELECT * FROM products WHERE listing_id = ${sqlText(listingId)} LIMIT 1`, signal)).rows[0]
    if (row === undefined) {
      throw new CommerceError('source-missing', `listing ${listingId} is not present`, { ruleId: 'listing-id' })
    }
    const variants = await this.fixedQuery(sourceId,
      `SELECT listing_id FROM products WHERE parent_id = ${sqlText(listingId)} ORDER BY listing_id`, signal)
    const parent = textValue(row.parent_id)
    return {
      id: ListingId(String(row.listing_id ?? '')),
      title: String(row.title ?? ''),
      ...(parent === undefined ? {} : { parentId: ListingId(parent) }),
      variantIds: variants.rows.map(item => ListingId(String(item.listing_id ?? ''))),
      values: row,
    }
  }

  override async salesSummary(
    sourceId: CommerceSourceId,
    request: CommerceSalesSummaryRequest,
    signal?: AbortSignal,
  ): Promise<CommerceSalesSummary> {
    const conditions = [
      ...(request.from === undefined ? [] : [`ordered_at >= ${sqlText(request.from)}`]),
      ...(request.to === undefined ? [] : [`ordered_at <= ${sqlText(request.to)}`]),
    ]
    const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`
    const row = (await this.fixedQuery(sourceId,
      `SELECT COUNT(DISTINCT order_id) AS order_count, COALESCE(SUM(CAST(quantity AS REAL)),0) AS units_sold, COALESCE(SUM(CAST(gross_sales AS REAL)),0) AS gross_sales, COALESCE(MIN(NULLIF(currency,'')),'CNY') AS currency FROM orders${where}`,
      signal)).rows[0]
    return {
      orderCount: Number(row?.order_count ?? 0),
      unitsSold: Number(row?.units_sold ?? 0),
      grossSales: Number(row?.gross_sales ?? 0),
      currency: String(row?.currency ?? 'CNY'),
    }
  }

  override async inventoryHealth(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceInventoryHealth> {
    const result = await this.fixedQuery(sourceId,
      'SELECT listing_id, CAST(available AS REAL) AS available, CAST(low_stock_threshold AS REAL) AS threshold FROM inventory ORDER BY listing_id',
      signal)
    return {
      items: result.rows.map((row) => {
        const available = Number(row.available ?? 0)
        const threshold = Number(row.threshold ?? 0)
        return {
          listingId: ListingId(String(row.listing_id ?? '')),
          available,
          status: available <= 0 ? 'out-of-stock' : available <= threshold ? 'low' : 'healthy',
        }
      }),
    }
  }

  override async analysisSchema(
    sourceId: CommerceSourceId,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisSchema> {
    const tables = (await this.fixedQuery(sourceId,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orders','products','inventory') ORDER BY name",
      signal)).rows
    return {
      tables: await Promise.all(tables.map(async (row) => {
        const name = String(row.name ?? '')
        const columns = await this.fixedQuery(sourceId,
          `SELECT name, type FROM pragma_table_info(${sqlText(name)}) ORDER BY cid`, signal)
        return {
          name,
          columns: columns.rows.map(column => ({
            name: String(column.name ?? ''), type: String(column.type ?? ''),
          })),
        }
      })),
    }
  }

  override runAnalysisQuery(
    sourceId: CommerceSourceId,
    query: string,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisResult> {
    return this.query(sourceId, validateAnalysisQuery(query), this.config.analysis, signal)
  }

  /**
   * Render staged changes through one configured platform mapping.
   * @param changes - staged changes to serialize.
   * @param platformId - configured platform mapping id.
   * @param signal - caller lifetime.
   * @returns complete CSV text without writing a file.
   */
  override renderExport(
    changes: readonly CommerceChange[],
    platformId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted()
    return Promise.resolve(renderChangesCsv(changes, this.platform(platformId)))
  }

  private async decodeTable(
    kind: CommerceDataKind,
    platformId: string,
    filename: string,
    bytes: CommerceImportSpreadsheetRequest['bytes'],
    signal?: AbortSignal,
  ): Promise<{ imported: ImportedTable; warnings: readonly string[] }> {
    const mapping = this.platform(platformId)[kind]
    if (mapping === undefined) {
      throw new CommerceError('import-invalid', `platform ${platformId} has no ${kind} mapping`, {
        ruleId: 'platform-kind',
      })
    }
    let parsed: Awaited<ReturnType<typeof parseSpreadsheet>>
    try {
      parsed = await parseSpreadsheet(filename, bytes)
    } catch (cause: unknown) {
      throw decoderRefusal(cause, signal)
    }
    if (parsed.tables.length !== 1 || parsed.tables[0] === undefined) {
      throw new CommerceError('import-invalid', 'commerce imports require exactly one spreadsheet table', {
        ruleId: 'single-table',
      })
    }
    return { imported: mapImportedTable(kind, mapping, parsed.tables[0]), warnings: parsed.warnings }
  }

  /**
   * Publish a complete source database, then the manifest that names it. The
   * previous database stays reachable through a hard-linked backup until the
   * manifest commit succeeds, so a caught failure restores it with its mode; a
   * process crash between the database rename and the manifest rename can leave
   * the new database under the previous manifest. Cleanup after the commit only
   * logs a failure, because the import has already succeeded.
   */
  private async commitSource(
    database: string,
    replacing: boolean,
    tables: readonly ImportedTable[],
    manifest: CommerceManifest,
    signal?: AbortSignal,
  ): Promise<void> {
    const suffix = `${String(process.pid)}.${randomUUID()}`
    const temporary = `${database}.${suffix}.tmp`
    const backup = `${database}.${suffix}.bak`
    try {
      await writeSqliteFile(temporary, [...tables], signal, this.sqlite3)
      await chmod(temporary, WRITABLE_SOURCE_MODE)
    } catch (cause: unknown) {
      await removeSourceFile(temporary)
      throw storageFailure(cause)
    }
    try {
      if (replacing) {
        await link(database, backup)
        // Windows refuses to replace a read-only file; the linked backup shares this mode until restore.
        await chmod(database, WRITABLE_SOURCE_MODE)
      }
      await rename(temporary, database)
      await writeCommerceManifest(this.config.sourcesRoot, manifest)
    } catch (cause: unknown) {
      await restoreSource(database, temporary, replacing ? backup : undefined).catch((restoreError: unknown) => {
        throw new AggregateError([cause, restoreError], 'commerce import failed and the previous database could not be restored')
      })
      throw cause
    }
    const warnCleanup = (path: string, error: unknown): void => {
      this.ctx.logger.warn(`commerce-mode: import committed, but cleanup of ${path} failed: ${errorMessage(error)}`)
    }
    await chmod(database, COMMITTED_SOURCE_MODE).catch((error: unknown) => { warnCleanup(database, error) })
    if (replacing) await removeSourceFile(backup).catch((error: unknown) => { warnCleanup(backup, error) })
  }

  private platform(id: string): PlatformConfig {
    const platform = Object.hasOwn(this.config.platforms, id) ? this.config.platforms[id] : undefined
    if (platform === undefined) {
      throw new CommerceError('import-invalid', `unknown commerce platform ${id}`, { ruleId: 'platform-id' })
    }
    return platform
  }

  private readManifest(): Promise<CommerceManifest> {
    return readCommerceManifest(this.config.sourcesRoot)
  }

  private requireSource(manifest: CommerceManifest, sourceId: CommerceSourceId): StoredCommerceSource {
    validateSourceId(sourceId)
    const source = manifest.sources.find(item => item.id === sourceId)
    if (source === undefined) {
      throw new CommerceError('source-missing', `commerce source ${sourceId} is not present`, {
        ruleId: 'source-id',
      })
    }
    return source
  }

  private fixedQuery(
    sourceId: CommerceSourceId,
    query: string,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisResult> {
    return this.query(sourceId, query, { ...this.config.analysis, maxRows: this.config.analysis.maxRows }, signal)
  }

  private async query(
    sourceId: CommerceSourceId,
    query: string,
    limits: AnalysisLimits,
    signal?: AbortSignal,
  ): Promise<CommerceAnalysisResult> {
    this.requireSource(await this.readManifest(), sourceId)
    return executeAnalysisQuery(
      this.ctx,
      this.sqlite3,
      this.config.sourcesRoot,
      sourceDatabasePath(this.config.sourcesRoot, sourceId),
      query,
      limits,
      signal,
    )
  }

  private async replaceTable(
    database: string,
    existingKinds: readonly CommerceDataKind[],
    imported: ImportedTable,
    signal?: AbortSignal,
  ): Promise<ImportedTable[]> {
    const tables: ImportedTable[] = []
    for (const kind of ['orders', 'products', 'inventory'] as const) {
      if (kind === imported.name) {
        tables.push(imported)
        continue
      }
      if (!existingKinds.includes(kind)) continue
      const result = await executeAnalysisQuery(
        this.ctx,
        this.sqlite3,
        this.config.sourcesRoot,
        database,
        `SELECT * FROM ${quoteIdent(kind)}`,
        {
          maxRows: MAX_TOTAL_ROWS,
          maxOutputBytes: MAX_DECODED_CELL_BYTES,
          timeoutMs: this.config.analysis.timeoutMs,
          graceMs: this.config.analysis.graceMs,
        },
        signal,
      )
      tables.push({
        name: kind,
        columns: FIXED_COLUMNS[kind],
        rows: result.rows.map(row => FIXED_COLUMNS[kind].map(column => sqliteValue(row[column]))),
      })
    }
    return tables
  }

  private mutate<T>(task: () => Promise<T>): Promise<T> {
    // The chain orders this Host's imports; the file lock excludes other Hosts sharing sourcesRoot.
    const locked = (): Promise<T> => withFileLock(
      commerceManifestPath(this.config.sourcesRoot), task, { waitMs: this.config.lockWaitMs },
    )
    const run = this.mutationChain.then(locked, locked)
    this.mutationChain = run.then(() => undefined, () => undefined)
    return run
  }
}

function mapImportedTable(
  kind: CommerceDataKind,
  mapping: ColumnMapping,
  table: ImportedTable,
): ImportedTable {
  const indexes = new Map(table.columns.map((column, index) => [column, index]))
  for (const canonical of REQUIRED_COLUMNS[kind]) {
    const source = mapping[canonical]
    if (source === undefined || !indexes.has(source)) {
      throw new CommerceError('import-invalid', `missing mapped ${kind} column ${canonical}`, {
        ruleId: `column-${canonical}`,
      })
    }
  }
  return {
    name: kind,
    columns: FIXED_COLUMNS[kind],
    rows: table.rows.map(row => FIXED_COLUMNS[kind].map((canonical) => {
      const source = mapping[canonical]
      const index = source === undefined ? undefined : indexes.get(source)
      const value = index === undefined ? null : row[index] ?? null
      return numericColumn(kind, canonical) && value !== null ? numericValue(value, canonical) : value
    })),
  }
}

function numericColumn(kind: CommerceDataKind, column: string): boolean {
  return (kind === 'orders' && (column === 'quantity' || column === 'gross_sales'))
    || (kind === 'inventory' && (column === 'available' || column === 'low_stock_threshold'))
}

function numericValue(value: string | number, column: string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    throw new CommerceError('import-invalid', `mapped numeric column ${column} contains non-numeric data`, {
      ruleId: `numeric-${column}`,
    })
  }
  return numeric
}

function sqliteValue(value: CommerceValue | undefined): string | number | null {
  if (value === undefined || value === null) return null
  return typeof value === 'boolean' ? Number(value) : value
}

function orderedKinds(kinds: readonly CommerceDataKind[]): CommerceDataKind[] {
  const present = new Set(kinds)
  return (['orders', 'products', 'inventory'] as const).filter(kind => present.has(kind))
}

function errorFields(cause: unknown): { code?: unknown; message?: unknown; details?: { ruleId?: unknown; limit?: unknown } } {
  return typeof cause === 'object' && cause !== null ? cause : {}
}

/** Decoding reads only the supplied bytes, so its failures describe the merchant's file. */
function decoderRefusal(cause: unknown, signal?: AbortSignal): unknown {
  if (cause instanceof CommerceError || signal?.aborted === true) return cause
  const error = errorFields(cause)
  return new CommerceError('import-invalid', typeof error.message === 'string' ? error.message : 'commerce import failed', {
    ...(typeof error.details?.ruleId === 'string' ? { ruleId: error.details.ruleId } : {}),
    ...(typeof error.details?.limit === 'number' ? { limit: error.details.limit } : {}),
  })
}

/** Database writes keep filesystem, process, and cancellation failures as errors. */
function storageFailure(cause: unknown): unknown {
  const error = errorFields(cause)
  if (error.code !== 'sqlite3-missing') return cause
  return new CommerceError('sqlite3-unavailable', typeof error.message === 'string' ? error.message : 'sqlite3 is unavailable', {
    ruleId: 'sqlite3-missing',
  })
}

/** Restore the pre-import database state, including its committed mode, after a failed commit step. */
async function restoreSource(database: string, temporary: string, backup: string | undefined): Promise<void> {
  await removeSourceFile(temporary)
  if (backup === undefined) {
    await removeSourceFile(database)
    return
  }
  try {
    await rename(backup, database)
  } catch (error: unknown) {
    // The backup is absent only when linking failed, and then the database was never replaced.
    ignoreMissing(error)
    return
  }
  // Renaming a hard link onto its own inode is a no-op that leaves the backup name behind.
  await removeSourceFile(backup)
  await chmod(database, COMMITTED_SOURCE_MODE)
}

/** Remove a store file; Windows refuses to delete a read-only file, so it is made writable first. */
async function removeSourceFile(path: string): Promise<void> {
  await chmod(path, WRITABLE_SOURCE_MODE).catch(ignoreMissing)
  await unlink(path).catch(ignoreMissing)
}

/** Rethrow every filesystem error except an already-absent path. */
function ignoreMissing(error: unknown): void {
  if (errorFields(error).code !== 'ENOENT') throw error
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function optionalText<K extends string>(key: K, value: CommerceValue | undefined): Partial<Record<K, string>> {
  const text = textValue(value)
  return text === undefined ? {} : { [key]: text } as Partial<Record<K, string>>
}

function textValue(value: CommerceValue | undefined): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return String(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
