/**
 * Library-locked retrieve / lookup that loads bodies in the sidecar.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/retrieve
 */

import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type {
  AskKnowledgeBundle, AskKnowledgeBundleItem, AskKnowledgeLibraryId, AskKnowledgeLookup,
} from '@deepseek-ai/dsh-host-ask-knowledge'
import { parseAskKnowledgeLookupTerm, parseAskKnowledgeTerms } from '@deepseek-ai/dsh-host-ask-knowledge'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { withLibraryLock } from './library-lock.ts'
import { boundRetrieveResult, resolveResultBounds, type ResultBounds } from './result-bounds.ts'
import { runSidecar } from './sidecar.ts'

/**
 * Retrieve pages for already-validated terms, load bodies, then bound.
 * @param config - sidecar home.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param terms - validated terms.
 * @param bounds - effective payload caps.
 * @param signal - caller lifetime.
 * @returns bounded bundle.
 */
export async function retrieveLibraryBundle(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  terms: string[],
  bounds: ResultBounds,
  signal?: AbortSignal,
): Promise<AskKnowledgeBundle> {
  const parsed = parseAskKnowledgeTerms({ terms })
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const items: AskKnowledgeBundleItem[] = []
    const seen = new Set<string>()
    const warnings: { ruleId: string; message: string }[] = []
    for (const term of parsed) {
      const response = await runSidecar(config, {
        command: 'retrieve-bundle',
        vault,
        query: term,
      }, { signal })
      const rawItems = Array.isArray(response.items) ? response.items : []
      for (const raw of rawItems) {
        if (typeof raw !== 'object' || raw === null) continue
        const item = raw as { path?: unknown; title?: unknown; reason?: unknown; text?: unknown; kind?: unknown }
        if (typeof item.path !== 'string' || seen.has(item.path)) continue
        seen.add(item.path)
        const kind = item.kind === 'concept' || item.kind === 'entity' || item.kind === 'raw'
          ? item.kind
          : 'raw'
        items.push({
          path: item.path,
          title: typeof item.title === 'string' ? item.title : item.path,
          reason: typeof item.reason === 'string' ? item.reason : '',
          text: typeof item.text === 'string' ? item.text : '',
          kind,
        })
      }
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
    }
    if (items.length === 0) {
      throw new AskKnowledgeError('no-hit', 'ask-knowledge/no-hit')
    }
    return boundRetrieveResult(items, warnings, bounds)
  })
}

/**
 * Look up one term and attach sidecar body.
 * @param config - sidecar home.
 * @param knowledgeHome - app-data directory.
 * @param libraryId - catalog id.
 * @param term - validated term.
 * @param bounds - effective payload caps.
 * @param signal - caller lifetime.
 * @returns lookup fields.
 */
export async function lookupLibraryTerm(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  term: string,
  bounds: ResultBounds,
  signal?: AbortSignal,
): Promise<AskKnowledgeLookup> {
  const parsed = parseAskKnowledgeLookupTerm({ term })
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const response = await runSidecar(config, {
      command: 'lookup',
      vault,
      term: parsed,
    }, { signal })
    const text = typeof response.text === 'string' ? response.text : ''
    const path = typeof response.canonicalPath === 'string' ? response.canonicalPath : undefined
    if (path === undefined && text === '') {
      throw new AskKnowledgeError('no-hit', 'ask-knowledge/no-hit')
    }
    const bundle = boundRetrieveResult(
      [{
        path: path ?? parsed,
        title: parsed,
        reason: 'lookup',
        text,
        kind: 'concept',
      }],
      [],
      bounds,
    )
    return {
      term: parsed,
      ...path === undefined ? {} : { canonicalPath: path },
      ...bundle.items[0]?.text === undefined ? {} : { text: bundle.items[0].text },
      warnings: bundle.warnings,
    }
  })
}

/** Re-export for callers that only need the default bounds. */
export { resolveResultBounds }
