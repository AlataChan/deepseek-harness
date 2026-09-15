/** Replay projection for commerce binding, listing-read provenance, and the staged-change ledger. */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { ChangeId, CommerceSourceId, ListingId } from '@deepseek-ai/dsh-host-commerce'
import type { CommerceSessionState, CommerceToolMeta, StagedChange } from './types.ts'

export type {
  CommerceSessionProjection,
  CommerceSessionState,
  CommerceToolMeta,
  StagedChange,
  StagedChangeItem,
  StagedChangeStatus,
} from './types.ts'

const LISTING_PROVENANCE_TOOL_NAMES = new Set([
  'commerce_search_listings',
  'commerce_get_listing',
  'commerce_inventory_health',
])

const STAGING_TOOL_NAMES = new Set([
  'commerce_stage_listing_update',
  'commerce_stage_price_change',
  'commerce_stage_promotion',
  'commerce_stage_restock',
  'commerce_stage_campaign',
])

const DISCARD_TOOL_NAME = 'commerce_discard_change'
const EXPORT_TOOL_NAME = 'commerce_export_changes'

const COMMERCE_TOOL_NAMES = new Set([
  'commerce_import_file',
  'commerce_load_sample',
  'commerce_sales_summary',
  'commerce_analysis_query',
  ...LISTING_PROVENANCE_TOOL_NAMES,
  ...STAGING_TOOL_NAMES,
  DISCARD_TOOL_NAME,
  EXPORT_TOOL_NAME,
])

const listingIdSchema = z.string().transform(value => ListingId(value))
const changeIdSchema = z.string().transform(value => ChangeId(value))
const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

const bindingSchema = z.union([
  z.object({
    sourceId: z.string().transform(value => CommerceSourceId(value)),
    displayName: z.string(),
    kinds: z.array(z.enum(['orders', 'products', 'inventory'])).readonly(),
  }),
  z.null(),
])

const stagedChangeSchema = z.object({
  id: changeIdSchema,
  kind: z.enum(['listing-update', 'price-change', 'promotion', 'restock', 'campaign']),
  summary: z.string(),
  items: z.array(z.object({
    listingId: listingIdSchema.nullable(),
    field: z.string(),
    before: valueSchema,
    after: valueSchema,
  })).readonly(),
  status: z.enum(['staged', 'discarded', 'exported']),
  window: z.object({ startsOn: z.string(), endsOn: z.string() }).optional(),
  campaign: z.object({ name: z.string(), listingIds: z.array(listingIdSchema).readonly() }).optional(),
})

const metaSchema = z.object({
  listingIds: z.array(listingIdSchema).readonly(),
  fullListing: z.boolean(),
  staged: stagedChangeSchema.optional(),
  discardedChangeId: changeIdSchema.optional(),
  exportedChangeIds: z.array(changeIdSchema).readonly().optional(),
  exportPath: z.string().optional(),
})

const stateSchema = z.object({
  binding: bindingSchema,
  readListingIds: z.array(listingIdSchema).readonly(),
  fullReadListingIds: z.array(listingIdSchema).readonly(),
  ledger: z.array(stagedChangeSchema).readonly(),
  pendingCalls: z.record(z.string(), z.string()).readonly(),
})

const viewSchema = stateSchema.omit({ pendingCalls: true })

function appendUnique(current: readonly ListingId[], additions: readonly ListingId[]): readonly ListingId[] {
  if (additions.length === 0) return current
  const next = [...current]
  const seen = new Set(current)
  for (const id of additions) {
    if (seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next
}

function readMeta(value: unknown): CommerceToolMeta | undefined {
  const parsed = metaSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function appendStaged(ledger: readonly StagedChange[], staged: StagedChange): readonly StagedChange[] {
  if (ledger.some(change => change.id === staged.id)) return ledger
  return [...ledger, { ...staged, status: 'staged' }]
}

function discard(ledger: readonly StagedChange[], changeId: ChangeId): readonly StagedChange[] {
  return ledger.map(change => change.id === changeId && change.status === 'staged'
    ? { ...change, status: 'discarded' }
    : change)
}

function markExported(ledger: readonly StagedChange[], changeIds: readonly ChangeId[]): readonly StagedChange[] {
  const exported = new Set<string>(changeIds)
  return ledger.map(change => exported.has(change.id) && change.status === 'staged'
    ? { ...change, status: 'exported' }
    : change)
}

/** Commerce session projection used by tools, session controllers, and clients. */
export const commerceSessionProjectionDefinition = {
  key: 'commerceSession',
  stateSchema,
  init: (): CommerceSessionState => ({
    binding: null,
    readListingIds: [],
    fullReadListingIds: [],
    ledger: [],
    pendingCalls: {},
  }),
  apply: (state, event) => {
    if (event.type === 'commerce/bound') return { ...state, binding: event.data }
    if (event.type === 'tool/call') {
      if (!COMMERCE_TOOL_NAMES.has(event.data.name)) return state
      return {
        ...state,
        pendingCalls: { ...state.pendingCalls, [event.data.callId]: event.data.name },
      }
    }
    if (event.type !== 'tool/result') return state
    const callId = event.data.message.source.callId
    const toolName = state.pendingCalls[callId]
    if (toolName === undefined) return state
    const pendingCalls = Object.fromEntries(
      Object.entries(state.pendingCalls).filter(([pendingCallId]) => pendingCallId !== callId),
    )
    const meta = readMeta(event.data.meta)
    if (meta === undefined) return { ...state, pendingCalls }
    if (LISTING_PROVENANCE_TOOL_NAMES.has(toolName)) {
      return {
        ...state,
        pendingCalls,
        readListingIds: appendUnique(state.readListingIds, meta.listingIds),
        fullReadListingIds: meta.fullListing && toolName === 'commerce_get_listing'
          ? appendUnique(state.fullReadListingIds, meta.listingIds)
          : state.fullReadListingIds,
      }
    }
    if (STAGING_TOOL_NAMES.has(toolName) && meta.staged !== undefined) {
      return { ...state, pendingCalls, ledger: appendStaged(state.ledger, meta.staged) }
    }
    if (toolName === EXPORT_TOOL_NAME && meta.exportedChangeIds !== undefined) {
      return { ...state, pendingCalls, ledger: markExported(state.ledger, meta.exportedChangeIds) }
    }
    if (toolName === DISCARD_TOOL_NAME && meta.discardedChangeId !== undefined) {
      return { ...state, pendingCalls, ledger: discard(state.ledger, meta.discardedChangeId) }
    }
    return { ...state, pendingCalls }
  },
  wire: {
    viewSchema,
    view: state => ({
      binding: state.binding,
      readListingIds: state.readListingIds,
      fullReadListingIds: state.fullReadListingIds,
      ledger: state.ledger,
    }),
  },
  stateVersion: 2,
} satisfies ProjectionDefinition<'commerceSession', CommerceSessionState>
