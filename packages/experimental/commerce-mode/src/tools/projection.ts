/** Replay projection for commerce binding and listing-read provenance. */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { CommerceSourceId, ListingId } from '@deepseek-ai/dsh-host-commerce'
import type { CommerceSessionState, CommerceToolMeta } from './types.ts'

export type { CommerceSessionProjection, CommerceSessionState, CommerceToolMeta } from './types.ts'

const COMMERCE_TOOL_NAMES = new Set([
  'commerce_import_file',
  'commerce_load_sample',
  'commerce_search_listings',
  'commerce_get_listing',
  'commerce_sales_summary',
  'commerce_inventory_health',
  'commerce_analysis_query',
])

const LISTING_PROVENANCE_TOOL_NAMES = new Set([
  'commerce_search_listings',
  'commerce_get_listing',
  'commerce_inventory_health',
])

const bindingSchema = z.union([
  z.object({
    sourceId: z.string().transform(value => CommerceSourceId(value)),
    displayName: z.string(),
    kinds: z.array(z.enum(['orders', 'products', 'inventory'])).readonly(),
  }),
  z.null(),
])

const stateSchema = z.object({
  binding: bindingSchema,
  readListingIds: z.array(z.string().transform(value => ListingId(value))).readonly(),
  fullReadListingIds: z.array(z.string().transform(value => ListingId(value))).readonly(),
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
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.listingIds) || !record.listingIds.every(id => typeof id === 'string')) return undefined
  if (typeof record.fullListing !== 'boolean') return undefined
  return { listingIds: record.listingIds.map((id: string) => ListingId(id)), fullListing: record.fullListing }
}

/** Commerce session projection used by tools, session controllers, and clients. */
export const commerceSessionProjectionDefinition = {
  key: 'commerceSession',
  stateSchema,
  init: (): CommerceSessionState => ({
    binding: null,
    readListingIds: [],
    fullReadListingIds: [],
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
    if (meta === undefined || !LISTING_PROVENANCE_TOOL_NAMES.has(toolName)) return { ...state, pendingCalls }
    return {
      ...state,
      pendingCalls,
      readListingIds: appendUnique(state.readListingIds, meta.listingIds),
      fullReadListingIds: meta.fullListing && toolName === 'commerce_get_listing'
        ? appendUnique(state.fullReadListingIds, meta.listingIds)
        : state.fullReadListingIds,
    }
  },
  wire: {
    viewSchema,
    view: state => ({
      binding: state.binding,
      readListingIds: state.readListingIds,
      fullReadListingIds: state.fullReadListingIds,
    }),
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'commerceSession', CommerceSessionState>
