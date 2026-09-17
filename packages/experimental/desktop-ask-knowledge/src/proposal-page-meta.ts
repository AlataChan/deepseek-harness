/**
 * Rewrite LLM `create_page` frontmatter the frozen sidecar rejects.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/proposal-page-meta
 */

import { readFile, writeFile } from 'node:fs/promises'

/** page-meta.json `type` enum. */
const PAGE_TYPES = new Set([
  'concept', 'entity', 'comparison', 'timeline', 'log', 'note', 'meta', 'raw_source',
])

/** page-meta.json `role` enum. */
const PAGE_ROLES = new Set([
  'concept', 'entity', 'comparison', 'timeline', 'log', 'index', 'schema', 'note', 'raw_source',
])

/**
 * Replace `type` / `role` values the page-meta schema does not allow.
 * Propose often writes `wiki` for both; apply then rejects and Host used to
 * treat that as applied.
 * @param proposal - sidecar proposal JSON.
 * @returns true when a field was rewritten.
 */
export function rewriteInvalidCreatePageMeta(proposal: unknown): boolean {
  if (typeof proposal !== 'object' || proposal === null) return false
  const operations = Reflect.get(proposal, 'operations')
  if (!Array.isArray(operations)) return false
  let changed = false
  for (const op of operations) {
    if (typeof op !== 'object' || op === null) continue
    if (Reflect.get(op, 'op') !== 'create_page') continue
    const frontmatter = Reflect.get(op, 'frontmatter')
    if (typeof frontmatter !== 'object' || frontmatter === null) continue
    const row = frontmatter as Record<string, unknown>
    if (!PAGE_TYPES.has(String(row.type ?? ''))) {
      row.type = 'note'
      changed = true
    }
    if (!PAGE_ROLES.has(String(row.role ?? ''))) {
      const type = String(row.type)
      row.role = PAGE_ROLES.has(type) ? type : 'note'
      changed = true
    }
  }
  return changed
}

/**
 * Read a proposal file and rewrite invalid page-meta in place.
 * @param path - absolute proposal JSON path.
 */
export async function rewriteProposalPageMetaFile(path: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!rewriteInvalidCreatePageMeta(parsed)) return
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

/**
 * Drop the aliases a retired fill copied from a page's own tags.
 *
 * Every tag used to become an alias as well, so two pages of one proposal that
 * shared a tag left that alias resolving to both and the post-apply lint rolled
 * the whole proposal back. Only an alias repeating one of that page's own tags is
 * dropped, which is what the fill produced; an alias the model authored stays.
 * @param proposal - sidecar proposal JSON.
 * @returns true when an alias was dropped.
 */
export function rewriteTagDerivedAliases(proposal: unknown): boolean {
  if (typeof proposal !== 'object' || proposal === null) return false
  const operations: unknown = (proposal as Record<string, unknown>).operations
  if (!Array.isArray(operations)) return false
  let changed = false
  for (const operation of operations as readonly unknown[]) {
    if (typeof operation !== 'object' || operation === null) continue
    const op = operation as Record<string, unknown>
    if (op.op !== 'create_page') continue
    const frontmatter = op.frontmatter
    if (typeof frontmatter !== 'object' || frontmatter === null) continue
    const row = frontmatter as Record<string, unknown>
    const aliases = row.aliases
    const tags = row.tags
    if (!Array.isArray(aliases) || !Array.isArray(tags)) continue
    const tagNames = new Set((tags as readonly unknown[]).map(tag => String(tag).trim()))
    const kept = (aliases as readonly unknown[]).filter(alias => !tagNames.has(String(alias).trim()))
    if (kept.length === aliases.length) continue
    if (kept.length === 0) delete row.aliases
    else row.aliases = kept
    changed = true
  }
  return changed
}
