/**
 * Atomic `catalog.json` under `<app_data>/knowledge-bases/`.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/catalog
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeLibrary } from '@deepseek-ai/dsh-host-ask-knowledge'
import { bootstrapVault } from './bootstrap-vault.ts'
import { withCatalogLock, withCatalogThenLibrary } from './library-lock.ts'

/** On-disk format version. Unknown versions fail the read. */
export const CATALOG_VERSION = 1

const VAULT_REL = /^libraries\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const storedLibrarySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  createdAt: z.string().min(1),
  lastUsedAt: z.string().min(1),
  vaultRelPath: z.string().min(1),
  missing: z.boolean().optional(),
  deleting: z.boolean().optional(),
}).strict()

const catalogSchema = z.object({
  version: z.literal(CATALOG_VERSION),
  libraries: z.array(storedLibrarySchema),
}).strict()

/** One persisted catalog row. */
export interface StoredAskKnowledgeLibrary {
  readonly id: AskKnowledgeLibraryId
  readonly displayName: string
  readonly createdAt: string
  readonly lastUsedAt: string
  readonly vaultRelPath: string
  readonly missing?: boolean
  readonly deleting?: boolean
}

/** Parsed catalog document. */
export interface AskKnowledgeCatalogDocument {
  readonly version: typeof CATALOG_VERSION
  readonly libraries: readonly StoredAskKnowledgeLibrary[]
}

/**
 * Absolute knowledge-bases directory.
 * @param knowledgeHome - resolved app-data directory.
 * @returns `…/knowledge-bases`.
 */
export function knowledgeBasesRoot(knowledgeHome: string): string {
  return join(resolve(knowledgeHome), 'knowledge-bases')
}

/**
 * Absolute catalog path.
 * @param knowledgeHome - resolved app-data directory.
 * @returns `catalog.json`.
 */
export function catalogPath(knowledgeHome: string): string {
  return join(knowledgeBasesRoot(knowledgeHome), 'catalog.json')
}

/**
 * Absolute vault directory for a stored row.
 * @param knowledgeHome - resolved app-data directory.
 * @param row - catalog row.
 * @returns absolute vault path inside `libraries/<id>/`.
 */
export async function assertVaultDir(
  knowledgeHome: string,
  row: StoredAskKnowledgeLibrary,
): Promise<string> {
  if (!VAULT_REL.test(row.vaultRelPath)) {
    throw new AskKnowledgeError('path-escape', `vaultRelPath is not libraries/<id>: ${row.vaultRelPath}`)
  }
  const root = knowledgeBasesRoot(knowledgeHome)
  const allowed = join(root, row.vaultRelPath)
  const rel = relative(root, allowed)
  /* v8 ignore next 3 -- VAULT_REL already rejects any vaultRelPath that can leave root */
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new AskKnowledgeError('path-escape', 'vault path leaves knowledge-bases/')
  }
  try {
    const realRoot = await realpath(root)
    const realVault = await realpath(allowed)
    const realRel = relative(realRoot, realVault)
    if (realRel.startsWith('..') || realRel.split(sep).includes('..')) {
      throw new AskKnowledgeError('path-escape', 'symlink leaves knowledge-bases/')
    }
    return realVault
  } catch (error: unknown) {
    if (error instanceof AskKnowledgeError) throw error
    return allowed
  }
}

/**
 * Read the catalog, or return an empty document when the file is absent.
 * @param knowledgeHome - resolved app-data directory.
 * @returns parsed document.
 */
export async function readCatalog(knowledgeHome: string): Promise<AskKnowledgeCatalogDocument> {
  const path = catalogPath(knowledgeHome)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return { version: CATALOG_VERSION, libraries: [] }
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AskKnowledgeError('library-missing', 'knowledge catalog is not JSON')
  }
  const result = catalogSchema.safeParse(parsed)
  if (!result.success) {
    throw new AskKnowledgeError('library-missing', 'knowledge catalog failed validation')
  }
  return {
    version: CATALOG_VERSION,
    libraries: result.data.libraries.map(hydrate),
  }
}

/**
 * Write the catalog through a temp file then rename.
 * @param knowledgeHome - resolved app-data directory.
 * @param document - document to persist.
 * @returns after the rename completes.
 */
export async function writeCatalog(
  knowledgeHome: string,
  document: AskKnowledgeCatalogDocument,
): Promise<void> {
  const path = catalogPath(knowledgeHome)
  await mkdir(dirname(path), { recursive: true })
  const body = `${JSON.stringify({
    version: CATALOG_VERSION,
    libraries: document.libraries.map(serialize),
  }, null, 2)}\n`
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
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
 * List catalog rows. Does not recover. Marks vanished vaults as missing.
 * @param knowledgeHome - resolved app-data directory.
 * @returns rows sorted by lastUsedAt descending.
 */
export async function listCatalog(knowledgeHome: string): Promise<AskKnowledgeLibrary[]> {
  const document = await readCatalog(knowledgeHome)
  const rows = await Promise.all(document.libraries.map(async row => toListRow(knowledgeHome, row)))
  return rows.toSorted((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
}

/**
 * Create a catalog row and empty vault.
 * @param knowledgeHome - resolved app-data directory.
 * @param displayName - user-visible name.
 * @returns the new list row.
 */
export async function createCatalogLibrary(
  knowledgeHome: string,
  displayName: string,
): Promise<AskKnowledgeLibrary> {
  const name = normalizeDisplayName(displayName)
  const id = AskKnowledgeLibraryId(randomUUID())
  const now = new Date().toISOString()
  const row: StoredAskKnowledgeLibrary = {
    id,
    displayName: name,
    createdAt: now,
    lastUsedAt: now,
    vaultRelPath: `libraries/${id}`,
  }
  return await withCatalogThenLibrary(knowledgeHome, id, async () => {
    const document = await readCatalog(knowledgeHome)
    const vault = await assertVaultDir(knowledgeHome, row)
    await mkdir(vault, { recursive: true })
    await bootstrapVault(vault)
    await writeCatalog(knowledgeHome, { version: CATALOG_VERSION, libraries: [...document.libraries, row] })
    return await toListRow(knowledgeHome, row)
  })
}

/**
 * Rename a catalog row.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - existing id.
 * @param displayName - new name.
 * @returns the updated list row.
 */
export async function renameCatalogLibrary(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  displayName: string,
): Promise<AskKnowledgeLibrary> {
  const name = normalizeDisplayName(displayName)
  return await withCatalogLock(knowledgeHome, async () => {
    const document = await readCatalog(knowledgeHome)
    const index = document.libraries.findIndex(row => row.id === libraryId)
    const current = document.libraries[index]
    if (current === undefined) throw new AskKnowledgeError('library-missing', `unknown library ${libraryId}`)
    if (current.deleting === true) {
      throw new AskKnowledgeError('library-deleting', `library ${libraryId} is deleting`)
    }
    const next: StoredAskKnowledgeLibrary = { ...current, displayName: name }
    const libraries = document.libraries.slice()
    libraries[index] = next
    await writeCatalog(knowledgeHome, { version: CATALOG_VERSION, libraries })
    return await toListRow(knowledgeHome, next)
  })
}

/**
 * Mark deleting, delete the vault, then drop the catalog row.
 * Session unbind is layered on by the Provider when those services exist.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - existing id.
 * @param unbind - optional live/cold unbind while catalog+library are held.
 */
export async function removeCatalogLibrary(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  unbind?: (row: StoredAskKnowledgeLibrary) => Promise<void>,
): Promise<void> {
  await withCatalogThenLibrary(knowledgeHome, libraryId, async () => {
    const document = await readCatalog(knowledgeHome)
    const index = document.libraries.findIndex(row => row.id === libraryId)
    const current = document.libraries[index]
    if (current === undefined) return
    const deleting: StoredAskKnowledgeLibrary = { ...current, deleting: true }
    const marked = document.libraries.slice()
    marked[index] = deleting
    await writeCatalog(knowledgeHome, { version: CATALOG_VERSION, libraries: marked })
    await unbind?.(deleting)
    try {
      const vault = await assertVaultDir(knowledgeHome, deleting)
      await rm(vault, { recursive: true, force: true })
    } catch (error: unknown) {
      /* v8 ignore start -- vanished vault is success; path-escape is asserted before rm */
      if (error instanceof AskKnowledgeError && error.code === 'path-escape') throw error
      /* v8 ignore stop */
    }
    const after = await readCatalog(knowledgeHome)
    await writeCatalog(knowledgeHome, {
      version: CATALOG_VERSION,
      libraries: after.libraries.filter(row => row.id !== libraryId),
    })
  })
}

/**
 * Finish any `deleting` rows left by a crashed remove.
 * @param knowledgeHome - resolved app-data directory.
 */
export async function resumeDeleting(knowledgeHome: string): Promise<void> {
  const document = await readCatalog(knowledgeHome)
  for (const row of document.libraries) {
    if (row.deleting === true) {
      await removeCatalogLibrary(knowledgeHome, row.id)
    }
  }
}

/**
 * Touch lastUsedAt.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - existing id.
 */
export async function touchLastUsed(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<void> {
  await withCatalogLock(knowledgeHome, async () => {
    const document = await readCatalog(knowledgeHome)
    const index = document.libraries.findIndex(row => row.id === libraryId)
    const current = document.libraries[index]
    if (current === undefined) throw new AskKnowledgeError('library-missing', `unknown library ${libraryId}`)
    const libraries = document.libraries.slice()
    libraries[index] = { ...current, lastUsedAt: new Date().toISOString() }
    await writeCatalog(knowledgeHome, { version: CATALOG_VERSION, libraries })
  })
}

/**
 * Load one stored row or throw.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - existing id.
 * @returns stored row.
 */
export async function requireLibrary(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<StoredAskKnowledgeLibrary> {
  const document = await readCatalog(knowledgeHome)
  const row = document.libraries.find(item => item.id === libraryId)
  if (row === undefined) throw new AskKnowledgeError('library-missing', `unknown library ${libraryId}`)
  if (row.deleting === true) {
    throw new AskKnowledgeError('library-deleting', `library ${libraryId} is deleting`)
  }
  return row
}

async function toListRow(
  knowledgeHome: string,
  row: StoredAskKnowledgeLibrary,
): Promise<AskKnowledgeLibrary> {
  let missing = row.missing === true
  try {
    const vault = await assertVaultDir(knowledgeHome, row)
    await stat(vault)
  } catch (error: unknown) {
    if (error instanceof AskKnowledgeError) throw error
    missing = true
  }
  return {
    id: row.id,
    displayName: row.displayName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    missing,
    deleting: row.deleting === true,
  }
}

function hydrate(row: z.infer<typeof storedLibrarySchema>): StoredAskKnowledgeLibrary {
  return {
    id: AskKnowledgeLibraryId(row.id),
    displayName: row.displayName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    vaultRelPath: row.vaultRelPath,
    ...row.missing === undefined ? {} : { missing: row.missing },
    ...row.deleting === undefined ? {} : { deleting: row.deleting },
  }
}

function serialize(row: StoredAskKnowledgeLibrary): z.infer<typeof storedLibrarySchema> {
  return {
    id: row.id,
    displayName: row.displayName,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    vaultRelPath: row.vaultRelPath,
    ...row.missing === undefined ? {} : { missing: row.missing },
    ...row.deleting === undefined ? {} : { deleting: row.deleting },
  }
}

function normalizeDisplayName(displayName: string): string {
  const name = displayName.trim()
  if (name === '') throw new AskKnowledgeError('library-missing', 'displayName is empty')
  if ([...name].length > 64) throw new AskKnowledgeError('library-missing', 'displayName is longer than 64')
  return name
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
