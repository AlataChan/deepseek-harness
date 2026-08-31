/**
 * Atomic overlay manifest under the resolved profile `data-sources/` tree.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/manifest
 */

import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AskDataConnectionRef, AskDataSourceId,
} from '@deepseek-ai/dsh-host-ask-data'
import type { AskDataSource } from '@deepseek-ai/dsh-host-ask-data'

/** On-disk format version. Unknown versions fail the read. */
export const MANIFEST_VERSION = 1

const storedSourceSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  kind: z.enum(['sample', 'import']),
  sqlitePath: z.string().min(1),
  sourceCopyPath: z.string().min(1),
  connectionRef: z.string().min(1).optional(),
  lastUsedAt: z.string().min(1).optional(),
  warnings: z.array(z.string()),
}).strict()

const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  sources: z.array(storedSourceSchema),
}).strict()

/** One persisted overlay row (`sample` | `import` only). */
export interface StoredAskDataSource {
  readonly id: AskDataSourceId
  readonly displayName: string
  readonly kind: 'sample' | 'import'
  readonly sqlitePath: string
  readonly sourceCopyPath: string
  readonly connectionRef?: AskDataConnectionRef
  readonly lastUsedAt?: string
  readonly warnings: readonly string[]
}

/** Parsed manifest document. */
export interface AskDataManifestDocument {
  readonly version: typeof MANIFEST_VERSION
  readonly sources: readonly StoredAskDataSource[]
}

/** Closed manifest failures. */
export type ManifestErrorCode = 'manifest-version' | 'manifest-invalid' | 'path-escape'

/** Typed manifest failure. */
export class ManifestError extends Error {
  /**
   * @param code - closed failure code.
   * @param message - operator-facing description.
   */
  constructor(readonly code: ManifestErrorCode, message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/**
 * Resolve the overlay data-sources root.
 * @param dataHome - already-resolved profile data-sources directory.
 * @returns absolute data-sources path.
 */
export function dataSourcesRoot(dataHome: string): string {
  return resolve(dataHome)
}

/**
 * Absolute path of `manifest.json`.
 * @param dataHome - already-resolved profile data-sources directory.
 * @returns absolute manifest path.
 */
export function manifestPath(dataHome: string): string {
  return join(dataSourcesRoot(dataHome), 'manifest.json')
}

/**
 * Import directory for one source id.
 * @param dataHome - already-resolved profile data-sources directory.
 * @param id - source id.
 * @returns absolute import directory.
 */
export function importDir(dataHome: string, id: AskDataSourceId): string {
  return join(dataSourcesRoot(dataHome), 'imports', id)
}

/**
 * Reject a path that leaves `data-sources/imports/<id>/` or follows a symlink
 * out of the profile data-sources root.
 * @param dataHome - already-resolved profile data-sources directory.
 * @param id - source id the path must stay under.
 * @param candidate - absolute or relative path from the manifest.
 * @returns the resolved absolute path inside the import directory.
 */
export async function assertInsideImport(
  dataHome: string,
  id: AskDataSourceId,
  candidate: string,
): Promise<string> {
  const root = dataSourcesRoot(dataHome)
  const allowed = importDir(dataHome, id)
  const resolved = resolve(allowed, candidate)
  const rel = relative(allowed, resolved)
  if (rel.startsWith('..') || rel.split(sep).includes('..') || resolve(resolved) !== resolved) {
    throw new ManifestError('path-escape', `path leaves data-sources/imports/${id}/`)
  }
  let realRoot: string
  let realPath: string
  try {
    realRoot = await realpath(root)
    realPath = await realpath(resolved)
  } catch {
    return resolved
  }
  const realRel = relative(realRoot, realPath)
  if (realRel.startsWith('..') || realRel.split(sep).includes('..')) {
    throw new ManifestError('path-escape', 'symlink leaves profile data-sources')
  }
  return resolved
}

/**
 * Read the manifest, or return an empty document when the file is absent.
 * @param dataHome - already-resolved profile data-sources directory.
 * @returns parsed document.
 */
export async function readManifest(dataHome: string): Promise<AskDataManifestDocument> {
  const path = manifestPath(dataHome)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return { version: MANIFEST_VERSION, sources: [] }
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ManifestError('manifest-invalid', 'data-sources manifest is not JSON')
  }
  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const version = (parsed as { version?: unknown } | null)?.version
    if (version !== MANIFEST_VERSION) {
      throw new ManifestError('manifest-version', `unsupported data-sources manifest version ${String(version)}`)
    }
    throw new ManifestError('manifest-invalid', 'data-sources manifest failed validation')
  }
  return {
    version: MANIFEST_VERSION,
    sources: result.data.sources.map(hydrate),
  }
}

/**
 * Write the manifest through a temp file then rename.
 * @param dataHome - already-resolved profile data-sources directory.
 * @param document - document to persist.
 * @returns after the rename completes.
 */
export async function writeManifest(
  dataHome: string,
  document: AskDataManifestDocument,
): Promise<void> {
  const path = manifestPath(dataHome)
  await mkdir(dirname(path), { recursive: true })
  const body = `${JSON.stringify({
    version: MANIFEST_VERSION,
    sources: document.sources.map(serialize),
  }, null, 2)}\n`
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, body, 'utf8')
  try {
    await rename(tmp, path)
  } catch (error: unknown) {
    try {
      await unlink(tmp)
    } catch {
      // temp file already gone after a racing rename
    }
    throw error
  }
}

/**
 * Project a stored row to the list face, marking a vanished sqlite as missing.
 * @param dataHome - already-resolved profile data-sources directory.
 * @param row - stored row.
 * @returns list row.
 */
export async function toListSource(
  dataHome: string,
  row: StoredAskDataSource,
): Promise<AskDataSource> {
  let missing = false
  try {
    const sqlite = await assertInsideImport(dataHome, row.id, row.sqlitePath)
    await stat(sqlite)
  } catch {
    missing = true
  }
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    ...row.connectionRef === undefined ? {} : { connectionRef: row.connectionRef },
    ...row.lastUsedAt === undefined ? {} : { lastUsedAt: row.lastUsedAt },
    warnings: [...row.warnings],
    missing,
  }
}

function hydrate(row: z.infer<typeof storedSourceSchema>): StoredAskDataSource {
  return {
    id: brandString<AskDataSourceId>(row.id),
    displayName: row.displayName,
    kind: row.kind,
    sqlitePath: row.sqlitePath,
    sourceCopyPath: row.sourceCopyPath,
    ...row.connectionRef === undefined
      ? {}
      : { connectionRef: brandString<AskDataConnectionRef>(row.connectionRef) },
    ...row.lastUsedAt === undefined ? {} : { lastUsedAt: row.lastUsedAt },
    warnings: row.warnings,
  }
}

function serialize(row: StoredAskDataSource): z.infer<typeof storedSourceSchema> {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    sqlitePath: row.sqlitePath,
    sourceCopyPath: row.sourceCopyPath,
    ...row.connectionRef === undefined ? {} : { connectionRef: row.connectionRef },
    ...row.lastUsedAt === undefined ? {} : { lastUsedAt: row.lastUsedAt },
    warnings: [...row.warnings],
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
