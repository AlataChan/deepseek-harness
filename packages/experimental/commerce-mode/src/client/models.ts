/**
 * Card models derived from one commerce tool call's logged arguments, result
 * content, and persisted result metadata. Metadata arrives from the durable
 * session log, so every field is checked before a card presents it.
 */

import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CommerceChangeKind, CommerceValue } from '@deepseek-ai/dsh-host-commerce/types'
import type { StagedChangeStatus } from '../tools/types.ts'

/** Staging tools whose successful result carries one staged change. */
export const STAGE_TOOL_NAMES = [
  'commerce_stage_listing_update',
  'commerce_stage_price_change',
  'commerce_stage_promotion',
  'commerce_stage_restock',
  'commerce_stage_campaign',
] as const

/** Tool whose successful result names one discarded change. */
export const DISCARD_TOOL_NAME = 'commerce_discard_change'

/** Tool whose successful result names the exported changes and file. */
export const EXPORT_TOOL_NAME = 'commerce_export_changes'

/** Every tool name this plugin registers a card for. */
export const COMMERCE_CARD_TOOL_NAMES: readonly string[] = [...STAGE_TOOL_NAMES, DISCARD_TOOL_NAME, EXPORT_TOOL_NAME]

const CHANGE_KINDS: readonly string[] = ['listing-update', 'price-change', 'promotion', 'restock', 'campaign']

/** Card lifecycle derived from the call slice alone. */
export type CommerceRowState = 'running' | 'ok' | 'error' | 'stopped'

/** One before/after line of a staged change. */
export interface ChangeLineModel {
  /** Listing the line changes; null for a campaign-level field. */
  readonly listingId: string | null
  readonly field: string
  readonly before: CommerceValue
  readonly after: CommerceValue
}

/** Staged change as recorded in the staging result metadata. */
export interface StagedChangeModel {
  readonly id: string
  readonly kind: CommerceChangeKind
  readonly summary: string
  readonly items: readonly ChangeLineModel[]
  readonly window: { readonly startsOn: string; readonly endsOn: string } | null
  readonly campaign: { readonly name: string; readonly listingIds: readonly string[] } | null
}

/** Everything a commerce card presents for one call. */
export interface CommerceCardModel {
  readonly state: CommerceRowState
  /** Flattened result text; null while running or when the result has no content. */
  readonly output: string | null
  readonly staged: StagedChangeModel | null
  readonly discardedChangeId: string | null
  readonly exportedChangeIds: readonly string[] | null
  readonly exportPath: string | null
}

/** Change counts of the session ledger by status. */
export type LedgerCounts = Readonly<Record<StagedChangeStatus, number>>

type Block = ToolCallViewProps['block']

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValue(value: unknown): value is CommerceValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function isKind(value: unknown): value is CommerceChangeKind {
  return typeof value === 'string' && CHANGE_KINDS.includes(value)
}

function stringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    items.push(item)
  }
  return items
}

function changeLine(value: unknown): ChangeLineModel | null {
  if (!isRecord(value)) return null
  const listingId = value.listingId === null ? null : typeof value.listingId === 'string' ? value.listingId : undefined
  const { field, before, after } = value
  if (listingId === undefined || typeof field !== 'string' || !isValue(before) || !isValue(after)) return null
  return { listingId, field, before, after }
}

function changeWindow(value: unknown): StagedChangeModel['window'] {
  if (!isRecord(value) || typeof value.startsOn !== 'string' || typeof value.endsOn !== 'string') return null
  return { startsOn: value.startsOn, endsOn: value.endsOn }
}

function changeCampaign(value: unknown): StagedChangeModel['campaign'] {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  const listingIds = stringList(value.listingIds)
  return listingIds === null ? null : { name: value.name, listingIds }
}

function stagedChange(value: unknown): StagedChangeModel | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  const { id, kind, summary } = value
  if (typeof id !== 'string' || !isKind(kind) || typeof summary !== 'string') return null
  const items: ChangeLineModel[] = []
  for (const raw of value.items) {
    const line = changeLine(raw)
    if (line === null) return null
    items.push(line)
  }
  return { id, kind, summary, items, window: changeWindow(value.window), campaign: changeCampaign(value.campaign) }
}

/**
 * First physical line of a text.
 * @param text - multi-line text.
 * @returns the text before the first newline.
 */
export function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function resultText(block: Block): string | null {
  if (!('kind' in block)) return null
  const parts = block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  if (parts.length === 0 && block.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`)
  return parts.join('\n') || null
}

/**
 * Derive the card model of one commerce call.
 * @param block - running call or settled result node.
 * @returns lifecycle, result text, and the validated metadata fields.
 */
export function commerceCardModel(block: Block): CommerceCardModel {
  const settled = 'kind' in block
  const state: CommerceRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const meta = settled && isRecord(block.meta) ? block.meta : undefined
  return {
    state,
    output: resultText(block),
    staged: stagedChange(meta?.staged),
    discardedChangeId: typeof meta?.discardedChangeId === 'string' ? meta.discardedChangeId : null,
    exportedChangeIds: stringList(meta?.exportedChangeIds),
    exportPath: typeof meta?.exportPath === 'string' ? meta.exportPath : null,
  }
}

/**
 * Short call identification from the logged arguments, used before a result names the change.
 * @param block - running call or settled result node.
 * @returns the staged summary, the discarded id, the exported ids, or the first argument line.
 */
export function callSummary(block: Block): string {
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    // Streaming exposes a truncated JSON prefix; its first line still identifies the call.
    return argsRaw === '' ? block.callId : firstLine(argsRaw)
  }
  if (isRecord(parsed)) {
    if (typeof parsed.summary === 'string') return firstLine(parsed.summary)
    if (typeof parsed.change_id === 'string') return parsed.change_id
    const ids = stringList(parsed.change_ids)
    if (ids !== null) return ids.join(', ')
  }
  return argsRaw === '' ? block.callId : firstLine(argsRaw)
}

/**
 * Count ledger changes by status.
 * @param ledger - the projected session ledger.
 * @returns staged, discarded, and exported counts.
 */
export function ledgerCounts(ledger: readonly { readonly status: StagedChangeStatus }[]): LedgerCounts {
  const counts = { staged: 0, discarded: 0, exported: 0 }
  for (const change of ledger) counts[change.status] += 1
  return counts
}
