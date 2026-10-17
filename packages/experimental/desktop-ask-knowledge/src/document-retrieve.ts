/**
 * Full-text passage retrieval and indexing over raw vault pages.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/document-retrieve
 */

import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { withLibraryLock } from './library-lock.ts'
import { runSidecar } from './sidecar.ts'

/** Single matched passage item returned by passage search. */
export interface PassageSearchItem {
  readonly path: string
  readonly title: string
  readonly passageId: string
  readonly text: string
  readonly kind: 'raw_passage' | 'concept' | 'entity' | 'raw' | 'index'
  readonly sourceRevision?: string
  /** Inclusive Unicode codepoint offset in the complete source revision. */
  readonly sourceStart?: number
  /** Exclusive Unicode codepoint offset in the complete source revision. */
  readonly sourceEnd?: number
  readonly score?: number | undefined
  readonly citations?: readonly string[] | undefined
  readonly relatedLinks?: readonly string[] | undefined
  readonly coverageStatus?: string | undefined
  readonly verification?: string | undefined
}

/** Result bundle from passage search. */
export interface PassageSearchResult {
  readonly items: readonly PassageSearchItem[]
  readonly cursor: string | null
  readonly totalMatches: number
  readonly generationId: string
  readonly warnings: readonly { readonly ruleId: string; readonly message: string }[]
  readonly tokenEstimate: number
}

/** Request parameters for searching passages in a library. */
export interface PassageSearchRequest {
  readonly libraryId: AskKnowledgeLibraryId
  readonly queries: readonly string[]
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
  readonly documentFilter?: string | undefined
  readonly maxChars?: number | undefined
  readonly maxBytes?: number | undefined
  readonly layer?: 'wiki' | 'raw' | 'all' | 'auto' | undefined
}

/**
 * Execute passage retrieval on a library with continuation support.
 * @param config - sidecar home.
 * @param knowledgeHome - app-data directory.
 * @param request - search options.
 * @param signal - caller lifetime.
 * @returns passage search result.
 */
export async function searchLibraryPassages(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  request: PassageSearchRequest,
  signal?: AbortSignal,
): Promise<PassageSearchResult> {
  const { libraryId, queries, limit = 12, cursor, documentFilter, maxChars = 24_000, layer = 'auto' } = request
  if (queries.length === 0) {
    return {
      items: [],
      cursor: null,
      totalMatches: 0,
      generationId: '',
      warnings: [],
      tokenEstimate: 0,
    }
  }

  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const response = await runSidecar(config, {
      command: 'passage-search',
      vault,
      queries: [...queries],
      limit,
      ...cursor ? { cursor } : {},
      ...documentFilter ? { documentFilter } : {},
      maxChars,
      maxBytes: request.maxBytes ?? 5000,
      layer,
    }, { signal })

    const rawItems = Array.isArray(response.items) ? response.items : []
    const items: PassageSearchItem[] = []

    for (const raw of rawItems) {
      if (typeof raw !== 'object' || raw === null) continue
      const item = raw as {
        path?: unknown
        title?: unknown
        passageId?: unknown
        text?: unknown
        kind?: unknown
        sourceRevision?: unknown
        sourceStart?: unknown
        sourceEnd?: unknown
        score?: unknown
        citations?: unknown
        relatedLinks?: unknown
        coverageStatus?: unknown
        verification?: unknown
      }
      const text = typeof item.text === 'string' ? item.text : ''
      items.push({
        path: typeof item.path === 'string' ? item.path : '',
        title: typeof item.title === 'string' ? item.title : '',
        passageId: typeof item.passageId === 'string' ? item.passageId : '',
        text,
        kind: item.kind === 'concept' || item.kind === 'entity' || item.kind === 'raw' || item.kind === 'index'
          ? item.kind
          : 'raw_passage',
        ...typeof item.sourceRevision === 'string' ? { sourceRevision: item.sourceRevision } : {},
        ...typeof item.sourceStart === 'number' ? { sourceStart: item.sourceStart } : {},
        ...typeof item.sourceEnd === 'number' ? { sourceEnd: item.sourceEnd } : {},
        ...typeof item.score === 'number' ? { score: item.score } : {},
        ...Array.isArray(item.citations) ? { citations: item.citations.map(String) } : {},
        ...Array.isArray(item.relatedLinks) ? { relatedLinks: item.relatedLinks.map(String) } : {},
        ...typeof item.coverageStatus === 'string' ? { coverageStatus: item.coverageStatus } : {},
        ...typeof item.verification === 'string' ? { verification: item.verification } : {},
      })
    }

    const warnings: { ruleId: string; message: string }[] = []
    if (Array.isArray(response.warnings)) {
      for (const warning of response.warnings) {
        if (typeof warning === 'object' && warning !== null && 'code' in warning) {
          warnings.push({
            ruleId: String((warning as { code: unknown }).code),
            message: String((warning as { message?: unknown }).message ?? ''),
          })
        }
      }
    }

    return {
      items,
      cursor: typeof response.cursor === 'string' ? response.cursor : null,
      totalMatches: typeof response.total_matches === 'number' ? response.total_matches : items.length,
      generationId: typeof response.generation_id === 'string' ? response.generation_id : '',
      warnings,
      tokenEstimate: Buffer.byteLength(JSON.stringify(response), 'utf8'),
    }
  })
}

/**
 * Trigger an explicit full re-index of the raw documents in a library.
 * @param config - sidecar home.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param signal - caller lifetime.
 * @returns reindex summary.
 */
export async function indexLibraryVault(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  signal?: AbortSignal,
): Promise<{ indexedFiles: number; totalPassages: number; generationId: string }> {
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const response = await runSidecar(config, {
      command: 'index-vault',
      vault,
    }, { signal })
    return {
      indexedFiles: typeof response.indexed_files === 'number' ? response.indexed_files : 0,
      totalPassages: typeof response.total_passages === 'number' ? response.total_passages : 0,
      generationId: typeof response.generation_id === 'string' ? response.generation_id : '',
    }
  })
}

/**
 * Preflight SQLite and FTS5 runtime capabilities.
 * @param config - sidecar home.
 * @param signal - caller lifetime.
 * @returns runtime capabilities.
 */
export async function checkSqliteRuntime(
  config: AskKnowledgeHomeConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; sqliteVersion: string; fts5: boolean; trigram: boolean; error: string | null }> {
  const response = await runSidecar(config, {
    command: 'runtime-check',
  }, { signal })
  return {
    ok: response.ok === true,
    sqliteVersion: typeof response.sqlite_version === 'string' ? response.sqlite_version : '',
    fts5: response.fts5 === true,
    trigram: response.trigram === true,
    error: typeof response.error === 'string' ? response.error : null,
  }
}

/** Authorized read of one indexed passage; cursor identity includes the passage and generation. */
export interface PassageReadRequest {
  readonly libraryId: AskKnowledgeLibraryId
  readonly passageId: string
  readonly cursor?: string
}

/**
 * Read bounded text from a passage in the explicitly authorized library.
 * @param config - owned sidecar runner.
 * @param knowledgeHome - catalog directory.
 * @param request - passage and opaque continuation.
 * @param signal - caller lifetime.
 * @returns one bounded passage page.
 */
export async function readLibraryPassage(config: AskKnowledgeHomeConfig, knowledgeHome: string,
  request: PassageReadRequest, signal?: AbortSignal): Promise<PassageSearchResult> {
  return withLibraryLock(request.libraryId, async () => {
    const vault = await assertVaultDir(knowledgeHome, await requireLibrary(knowledgeHome, request.libraryId))
    const result = await runSidecar(config, { command: 'passage-read', vault, passageId: request.passageId,
      ...request.cursor === undefined ? {} : { cursor: request.cursor } }, { signal })
    const items = result.items as PassageSearchItem[]
    if (!Array.isArray(items) || !items.every(item => typeof item.text === 'string' && typeof item.path === 'string')) throw new Error('Invalid passage response')
    return { items, cursor: typeof result.cursor === 'string' ? result.cursor : null,
      totalMatches: 1, generationId: String(result.generation_id), warnings: [],
      tokenEstimate: Buffer.byteLength(JSON.stringify(result), 'utf8') }
  })
}

/** Result bundle from wiki lookup. */
export interface WikiLookupResult {
  readonly term: string
  readonly canonicalPath?: string | undefined
  readonly text?: string | undefined
  readonly cursor?: string | null | undefined
  readonly citations?: readonly string[] | undefined
  readonly relatedLinks?: readonly string[] | undefined
  readonly coverageStatus?: string | undefined
  readonly warnings: readonly { readonly ruleId: string; readonly message: string }[]
}

/** Request parameters for looking up a wiki page in a library. */
export interface WikiLookupRequest {
  readonly libraryId: AskKnowledgeLibraryId
  readonly term: string
  readonly cursor?: string | undefined
  readonly maxChars?: number | undefined
}

/**
 * Look up a wiki page in the library with continuation support.
 * @param config - sidecar home.
 * @param knowledgeHome - app-data directory.
 * @param request - lookup parameters.
 * @param signal - caller lifetime.
 * @returns wiki lookup result.
 */
export async function lookupLibraryWiki(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  request: WikiLookupRequest,
  signal?: AbortSignal,
): Promise<WikiLookupResult> {
  return await withLibraryLock(request.libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, request.libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const response = await runSidecar(config, {
      command: 'lookup',
      vault,
      term: request.term,
      ...request.cursor ? { cursor: request.cursor } : {},
      ...request.maxChars ? { maxChars: request.maxChars } : {},
    }, { signal })
    const warnings: { ruleId: string; message: string }[] = []
    if (Array.isArray(response.warnings)) {
      for (const warning of response.warnings) {
        if (typeof warning === 'object' && warning !== null && 'code' in warning) {
          warnings.push({
            ruleId: String((warning as { code: unknown }).code),
            message: String((warning as { message?: unknown }).message ?? ''),
          })
        }
      }
    }
    return {
      term: request.term,
      ...typeof response.canonicalPath === 'string' ? { canonicalPath: response.canonicalPath } : {},
      ...typeof response.text === 'string' ? { text: response.text } : {},
      cursor: typeof response.cursor === 'string' ? response.cursor : null,
      ...Array.isArray(response.citations) ? { citations: response.citations.map(String) } : {},
      ...Array.isArray(response.relatedLinks) ? { relatedLinks: response.relatedLinks.map(String) } : {},
      ...typeof response.coverageStatus === 'string' ? { coverageStatus: response.coverageStatus } : {},
      warnings,
    }
  })
}
