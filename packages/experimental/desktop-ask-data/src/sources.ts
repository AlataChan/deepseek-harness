/**
 * Overlay source book: serialized manifest writes plus sample/import rows.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/sources
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AskDataError, AskDataSourceId,
  type AskDataImportPreview, type AskDataSource,
} from '@deepseek-ai/dsh-host-ask-data'
import type { Context } from '@deepseek-ai/cordis'
import { parseSpreadsheet, extensionOf } from './import-spreadsheet.ts'
import { SAMPLE_DISPLAY_NAME } from './limits.ts'
import {
  assertInsideImport, importDir, readManifest, toListSource, writeManifest,
  type StoredAskDataSource,
} from './manifest.ts'
import { listUnmatchedSaved } from './saved-connections.ts'
import { findSqlite3, readSqlitePreview, writeSqliteFile } from './sqlite-write.ts'

const SAMPLE_SQLITE = fileURLToPath(new URL('../samples/sample-sales.sqlite', import.meta.url))
const SAMPLE_XLSX = fileURLToPath(new URL('../samples/sample-sales.xlsx', import.meta.url))

/** Known sample preview when host sqlite3 is absent. */
const SAMPLE_TABLE_PREVIEW = {
  name: '销售明细',
  rowCount: 20,
  columns: ['日期', '渠道', '商品', '数量', '金额'],
}

/** Serialized write chain so two commits cannot drop a row. */
let writeChain: Promise<void> = Promise.resolve()

/**
 * Run `task` on the single manifest write chain.
 * @param task - exclusive writer.
 * @returns the task result.
 */
export function withManifestLock<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(() => undefined, () => undefined)
  return run
}

/**
 * List overlay rows, marking vanished sqlite files as missing.
 * @param dataHome - resolved data-sources directory.
 * @returns overlay-managed sources only.
 */
export async function listManagedSources(dataHome: string): Promise<AskDataSource[]> {
  const document = await readManifest(dataHome)
  return Promise.all(document.sources.map(row => toListSource(dataHome, row)))
}

/**
 * List overlay-managed sources plus unmatched data-agent connections.
 * @param ctx - Host context that may have the connections domain open.
 * @param dataHome - resolved data-sources directory.
 * @returns combined list.
 */
export async function listAllSources(ctx: Context, dataHome: string): Promise<AskDataSource[]> {
  const managed = await listManagedSources(dataHome)
  const refs = new Set(
    managed.flatMap(row => row.connectionRef === undefined ? [] : [row.connectionRef]),
  )
  return [...managed, ...listUnmatchedSaved(ctx, refs)]
}

/**
 * Load one stored row.
 * @param dataHome - resolved data-sources directory.
 * @param sourceId - row id.
 * @returns stored row.
 */
export async function getStoredSource(
  dataHome: string,
  sourceId: AskDataSourceId,
): Promise<StoredAskDataSource> {
  const document = await readManifest(dataHome)
  const row = document.sources.find(item => item.id === sourceId)
  if (row === undefined) {
    throw new AskDataError('source-missing', `data source "${sourceId}" is not in the overlay manifest`)
  }
  return row
}

/**
 * Import a spreadsheet into a new or replaced overlay row.
 * @param dataHome - resolved data-sources directory.
 * @param filename - user-visible name.
 * @param bytes - decoded file bytes.
 * @param replaceSourceId - optional existing import to overwrite.
 * @param signal - caller lifetime.
 * @returns preview from the written sqlite.
 */
export function importSpreadsheetSource(
  dataHome: string,
  filename: string,
  bytes: Uint8Array,
  replaceSourceId?: AskDataSourceId,
  signal?: AbortSignal,
): Promise<AskDataImportPreview> {
  return withManifestLock(async () => {
    signal?.throwIfAborted()
    const parsed = await parseSpreadsheet(filename, bytes)
    const sqlite3 = await findSqlite3()
    if (sqlite3 === undefined) {
      throw new AskDataError('sqlite3-missing', 'sqlite3 is not on PATH', { ruleId: 'sqlite3-missing' })
    }
    const document = await readManifest(dataHome)
    const existing = replaceSourceId === undefined
      ? undefined
      : document.sources.find(item => item.id === replaceSourceId)
    if (replaceSourceId !== undefined && existing === undefined) {
      throw new AskDataError('source-missing', `data source "${replaceSourceId}" is not in the overlay manifest`)
    }
    const id = existing?.id ?? brandString<AskDataSourceId>(`src-${randomUUID()}`)
    const dir = importDir(dataHome, id)
    await mkdir(dir, { recursive: true })
    const ext = extensionOf(filename) === 'csv' ? 'csv' : 'xlsx'
    const sqlitePath = 'data.sqlite'
    const sourceCopyPath = `source.${ext}`
    const absSqlite = await assertInsideImport(dataHome, id, sqlitePath)
    const absCopy = await assertInsideImport(dataHome, id, sourceCopyPath)
    await writeFile(absCopy, bytes)
    await writeSqliteFile(absSqlite, parsed.tables, signal)
    const row: StoredAskDataSource = {
      id,
      displayName: filename.split(/[/\\]/).pop() as string,
      kind: 'import',
      sqlitePath,
      sourceCopyPath,
      ...existing?.connectionRef === undefined ? {} : { connectionRef: existing.connectionRef },
      ...existing?.lastUsedAt === undefined ? {} : { lastUsedAt: existing.lastUsedAt },
      warnings: [...parsed.warnings],
    }
    const next = existing === undefined
      ? { version: 1 as const, sources: [...document.sources, row] }
      : {
        version: 1 as const,
        sources: document.sources.map(item => item.id === id ? row : item),
      }
    await writeManifest(dataHome, next)
    const tables = await readSqlitePreview(absSqlite, signal)
    const source = await toListSource(dataHome, row)
    return { source, tables, warnings: [...row.warnings] }
  })
}

/**
 * Copy the packaged sample sqlite into the manifest.
 * @param dataHome - resolved data-sources directory.
 * @param signal - caller lifetime.
 * @returns preview; uses the known sample schema when sqlite3 is absent.
 */
export function importSampleSource(
  dataHome: string,
  signal?: AbortSignal,
): Promise<AskDataImportPreview> {
  return withManifestLock(async () => {
    signal?.throwIfAborted()
    const document = await readManifest(dataHome)
    const existing = document.sources.find(item => item.kind === 'sample')
    const id = existing?.id ?? brandString<AskDataSourceId>(`src-${randomUUID()}`)
    const dir = importDir(dataHome, id)
    await mkdir(dir, { recursive: true })
    const sqlitePath = 'data.sqlite'
    const sourceCopyPath = 'source.xlsx'
    const absSqlite = await assertInsideImport(dataHome, id, sqlitePath)
    const absCopy = await assertInsideImport(dataHome, id, sourceCopyPath)
    await copyFile(SAMPLE_SQLITE, absSqlite)
    await copyFile(SAMPLE_XLSX, absCopy)
    const row: StoredAskDataSource = {
      id,
      displayName: SAMPLE_DISPLAY_NAME,
      kind: 'sample',
      sqlitePath,
      sourceCopyPath,
      ...existing?.connectionRef === undefined ? {} : { connectionRef: existing.connectionRef },
      ...existing?.lastUsedAt === undefined ? {} : { lastUsedAt: existing.lastUsedAt },
      warnings: [],
    }
    const next = existing === undefined
      ? { version: 1 as const, sources: [...document.sources, row] }
      : {
        version: 1 as const,
        sources: document.sources.map(item => item.id === id ? row : item),
      }
    await writeManifest(dataHome, next)
    const sqlite3 = await findSqlite3()
    const tables = sqlite3 === undefined
      ? [SAMPLE_TABLE_PREVIEW]
      : await readSqlitePreview(absSqlite, signal)
    const source = await toListSource(dataHome, row)
    return { source, tables, warnings: [] }
  })
}

/**
 * Update one stored row after bind (connectionRef / lastUsedAt).
 * @param dataHome - resolved data-sources directory.
 * @param next - replacement row.
 * @returns after the write.
 */
export function putStoredSource(dataHome: string, next: StoredAskDataSource): Promise<void> {
  return withManifestLock(async () => {
    const document = await readManifest(dataHome)
    const sources = document.sources.some(item => item.id === next.id)
      ? document.sources.map(item => item.id === next.id ? next : item)
      : [...document.sources, next]
    await writeManifest(dataHome, { version: 1, sources })
  })
}

export { SAMPLE_SQLITE, SAMPLE_XLSX, SAMPLE_TABLE_PREVIEW }
