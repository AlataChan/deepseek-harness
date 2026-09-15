/** Commerce staging tools: grounded, guardrail-checked changes recorded in the session ledger for approved export. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ChangeId,
  ListingId,
  type CommerceChangeKind,
  type CommerceListing,
  type CommerceSourceId,
  type CommerceValue,
} from '@deepseek-ai/dsh-host-commerce'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  checkGuardrails,
  label,
  positiveAmount,
  promotionDepthViolation,
  type GuardrailConfig,
} from './guardrails.ts'
import {
  binding,
  directCall,
  gateHeld,
  held,
  holdRecoverableFailure,
  ok,
  outputFor,
  unbound,
  type OutcomeBounds,
  type ToolOutcome,
} from './outcome.ts'
import { commerceSessionProjectionDefinition } from './projection.ts'
import type { CommerceSessionState, StagedChange, StagedChangeItem } from './types.ts'

/** Ledger bound and guardrails the staging tools enforce beside the shared result bounds. */
export interface StagingConfig extends OutcomeBounds {
  /** Maximum changes one session ledger holds, counting discarded and exported changes. */
  readonly maxStagedChanges: number
  /** Caps and field lists checked for every staged change. */
  readonly guardrails: GuardrailConfig
}

const SUMMARY_CHARS = 200
const CAMPAIGN_NAME_CHARS = 120
const LISTED_IDS = 10
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u

/** Calling agent, bound source, and session projection state for a bound direct call. */
export interface BoundSession {
  readonly agent: Agent
  readonly sourceId: CommerceSourceId
  readonly state: CommerceSessionState
}

/**
 * Require a direct call in a bound session.
 * @param ctx - scope holding the projection registry.
 * @param exec - tool run context.
 * @returns the bound session, or the held refusal.
 */
export function boundSession(ctx: Context, exec: ToolRunContext): { outcome: ToolOutcome } | BoundSession {
  const direct = directCall(exec)
  if ('outcome' in direct) return direct
  const current = binding(ctx, direct.agent)
  if (current === null) return { outcome: unbound() }
  const state = ctx.sessionProjections.stateOf(direct.agent.session, 'commerceSession')
    ?? commerceSessionProjectionDefinition.init()
  return { agent: direct.agent, sourceId: current.sourceId, state }
}

function stagingSession(ctx: Context, exec: ToolRunContext, config: StagingConfig): { outcome: ToolOutcome } | BoundSession {
  const session = boundSession(ctx, exec)
  if ('outcome' in session) return session
  if (session.state.ledger.length >= config.maxStagedChanges) {
    return {
      outcome: gateHeld(
        'ledger',
        `this session's ledger already holds ${String(session.state.ledger.length)} changes, its configured limit`,
        'Export the staged changes, then continue in a new commerce session.',
      ),
    }
  }
  return session
}

/**
 * Quote ids in a held message, escaped and capped at a fixed count.
 * @param ids - listing, change, or field names.
 * @returns a comma-separated list.
 */
export function idList(ids: readonly string[]): string {
  const listed = ids.slice(0, LISTED_IDS).map(label).join(', ')
  return ids.length > LISTED_IDS ? `${listed}, and ${String(ids.length - LISTED_IDS)} more` : listed
}

function provenanceHeld(state: CommerceSessionState, ids: readonly ListingId[]): ToolOutcome | undefined {
  const known = new Set<string>(state.readListingIds)
  const unread = [...new Set(ids)].filter(id => !known.has(id))
  if (unread.length === 0) return undefined
  return gateHeld(
    'provenance',
    `listing ids ${idList(unread)} were not returned by a commerce read in this session`,
    'Call commerce_search_listings or commerce_get_listing first and use ids from the results.',
  )
}

async function readListings(
  ctx: Context,
  sourceId: CommerceSourceId,
  ids: readonly ListingId[],
  signal: AbortSignal,
): Promise<ReadonlyMap<ListingId, CommerceListing>> {
  const listings = new Map<ListingId, CommerceListing>()
  for (const id of new Set(ids)) listings.set(id, await ctx.commerce.getListing(sourceId, id, signal))
  return listings
}

function familyHeld(listings: ReadonlyMap<ListingId, CommerceListing>, verb: 'priced' | 'stocked'): ToolOutcome | undefined {
  const families = [...listings.values()].filter(listing => listing.variantIds.length > 0)
  if (families.length === 0) return undefined
  const variants = [...new Set(families.flatMap(listing => listing.variantIds))]
  return gateHeld(
    'options',
    `listing ids ${idList(families.map(listing => listing.id))} have variants and are ${verb} per variant; their variant ids are ${idList(variants)}`,
    'Stage the variant ids instead. When the merchant named no variant, ask which ones, and stage every variant only when they said the change applies to all of them.',
  )
}

function listingValue(listing: CommerceListing | undefined, field: string): CommerceValue {
  if (listing === undefined || !Object.hasOwn(listing.values, field)) return null
  return listing.values[field] ?? null
}

function shorten(text: string, maxChars: number): string {
  const codePoints = Array.from(text)
  return codePoints.length <= maxChars ? text : `${codePoints.slice(0, maxChars - 1).join('')}…`
}

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function windowHeld(startsOn: string, endsOn: string): ToolOutcome | undefined {
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) {
    return held('starts_on and ends_on must be calendar dates in YYYY-MM-DD form. Correct the dates, then retry.')
  }
  if (startsOn > endsOn) return held('starts_on must not be later than ends_on. Correct the dates, then retry.')
  return undefined
}

function changeJson(change: StagedChange): Record<string, JsonValue> {
  const json: Record<string, JsonValue> = {
    id: change.id,
    kind: change.kind,
    summary: change.summary,
    status: change.status,
    items: change.items.map(item => ({ listingId: item.listingId, field: item.field, before: item.before, after: item.after })),
  }
  if (change.window !== undefined) json.window = { startsOn: change.window.startsOn, endsOn: change.window.endsOn }
  if (change.campaign !== undefined) json.campaign = { name: change.campaign.name, listingIds: [...change.campaign.listingIds] }
  return json
}

function stage(
  state: CommerceSessionState,
  kind: CommerceChangeKind,
  summary: string,
  items: readonly StagedChangeItem[],
  config: StagingConfig,
  details: Pick<StagedChange, 'window' | 'campaign'> = {},
): ToolOutcome {
  const violations = checkGuardrails(kind, items, config.guardrails)
  if (violations.length > 0) {
    return gateHeld(
      'guardrail',
      `the change exceeds this store's guardrails: ${violations.join('; ')}`,
      'Explain the limit to the merchant and propose a compliant change.',
    )
  }
  const change: StagedChange = {
    id: ChangeId(`chg-${String(state.ledger.length + 1).padStart(4, '0')}`),
    kind,
    summary: shorten(summary.trim(), SUMMARY_CHARS),
    items,
    status: 'staged',
    ...details,
  }
  return ok(change, [], false, config, {
    lead: `Staged ${change.id} for review only. Nothing changes in the store; an approved export writes staged changes to a CSV file.`,
    staged: changeJson(change),
  })
}

/**
 * Register the five staging tools and the discard tool on the current scope.
 * The tools run exclusively, so change ids follow ledger order.
 * @param ctx - scope holding the commerce, tools, and session projection services.
 * @param config - result bounds, ledger bound, and guardrails.
 */
export function registerStagingTools(ctx: Context, config: StagingConfig): void {
  const output = outputFor(config)

  ctx.tools.register(defineTool({
    name: 'commerce_stage_listing_update',
    description: 'Stage a content edit to one product listing in the bound commerce source for merchant review. Staging changes nothing in the store.',
    parameters: {
      listing_id: { type: 'string', required: true, description: 'Listing id read in full with commerce_get_listing.' },
      summary: { type: 'string', required: true, description: 'One sentence the merchant reads when reviewing this change.' },
      fields: {
        type: 'array',
        required: true,
        description: 'One entry per listing field to change.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string', required: true, description: 'Listing field name, such as title or description.' },
            value: { type: 'string', required: true, description: 'New text for the field.' },
          },
        },
      },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = stagingSession(ctx, exec, config)
        if ('outcome' in session) return session.outcome
        if (args.fields.length === 0) return held('Provide at least one field to change, then retry.')
        const listingId = ListingId(args.listing_id)
        const unread = provenanceHeld(session.state, [listingId])
        if (unread !== undefined) return unread
        if (!session.state.fullReadListingIds.includes(listingId)) {
          return gateHeld(
            'record-read',
            `a content edit to ${label(listingId)} needs the full listing record`,
            `Call commerce_get_listing for ${label(listingId)} first; search rows are summaries.`,
          )
        }
        const listing = await ctx.commerce.getListing(session.sourceId, listingId, exec.signal)
        const unknownFields = args.fields.map(entry => entry.field).filter(field => !Object.hasOwn(listing.values, field))
        if (unknownFields.length > 0) {
          return held(`${idList(unknownFields)} ${unknownFields.length === 1 ? 'is not a listing field' : 'are not listing fields'}. Listing fields are ${idList(Object.keys(listing.values))}; retry with those names.`)
        }
        const items = args.fields.map((entry): StagedChangeItem => ({
          listingId, field: entry.field, before: listingValue(listing, entry.field), after: entry.value,
        }))
        return stage(session.state, 'listing-update', args.summary, items, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_stage_price_change',
    description: 'Stage new prices for listings in the bound commerce source for merchant review. Current prices come from the source; staging changes nothing in the store.',
    parameters: {
      summary: { type: 'string', required: true, description: 'One sentence the merchant reads when reviewing this change.' },
      items: {
        type: 'array',
        required: true,
        description: 'One line per listing.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            listing_id: { type: 'string', required: true, description: 'Listing id returned by a commerce read.' },
            price: { type: 'number', required: true, description: 'New price in the listing currency.' },
          },
        },
      },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = stagingSession(ctx, exec, config)
        if ('outcome' in session) return session.outcome
        if (args.items.length === 0) return held('Provide at least one listing line, then retry.')
        const ids = args.items.map(item => ListingId(item.listing_id))
        const unread = provenanceHeld(session.state, ids)
        if (unread !== undefined) return unread
        const listings = await readListings(ctx, session.sourceId, ids, exec.signal)
        const family = familyHeld(listings, 'priced')
        if (family !== undefined) return family
        const items = args.items.map((item): StagedChangeItem => {
          const listingId = ListingId(item.listing_id)
          return { listingId, field: 'price', before: listingValue(listings.get(listingId), 'price'), after: item.price }
        })
        return stage(session.state, 'price-change', args.summary, items, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_stage_promotion',
    description: 'Stage a dated percentage discount on listings in the bound commerce source for merchant review. Promotion prices are computed from current source prices; staging changes nothing in the store.',
    parameters: {
      summary: { type: 'string', required: true, description: 'One sentence the merchant reads when reviewing this change.' },
      listing_ids: { type: 'array', required: true, description: 'Listing ids returned by a commerce read.', items: { type: 'string' } },
      discount_pct: { type: 'number', required: true, description: 'Discount off each current price, in percent.' },
      starts_on: { type: 'string', required: true, description: 'First promotion day, YYYY-MM-DD.' },
      ends_on: { type: 'string', required: true, description: 'Last promotion day, YYYY-MM-DD.' },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = stagingSession(ctx, exec, config)
        if ('outcome' in session) return session.outcome
        if (args.listing_ids.length === 0) return held('Provide at least one listing id, then retry.')
        const dates = windowHeld(args.starts_on, args.ends_on)
        if (dates !== undefined) return dates
        if (args.discount_pct <= 0) return held('discount_pct must be a positive percentage. Correct it, then retry.')
        const depth = promotionDepthViolation(args.discount_pct, config.guardrails)
        if (depth !== undefined) return gateHeld('guardrail', depth, 'Propose a shallower discount.')
        const ids = args.listing_ids.map(id => ListingId(id))
        const unread = provenanceHeld(session.state, ids)
        if (unread !== undefined) return unread
        const listings = await readListings(ctx, session.sourceId, ids, exec.signal)
        const family = familyHeld(listings, 'priced')
        if (family !== undefined) return family
        const items = [...new Set(ids)].map((listingId): StagedChangeItem => {
          const before = listingValue(listings.get(listingId), 'price')
          const price = positiveAmount(before)
          const after = price === undefined ? null : Math.round(price * (100 - args.discount_pct)) / 100
          return { listingId, field: 'promotion_price', before, after }
        })
        return stage(session.state, 'promotion', args.summary, items, config, {
          window: { startsOn: args.starts_on, endsOn: args.ends_on },
        })
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_stage_restock',
    description: 'Stage inventory additions for listings in the bound commerce source for merchant review. Current stock comes from the imported inventory table; staging changes nothing in the store.',
    /* jscpd:ignore-start -- parallel to commerce_stage_price_change: defineTool infers argument
       types from each literal per-listing schema, so the two tools keep symmetric schemas and gate preludes. */
    parameters: {
      summary: { type: 'string', required: true, description: 'One sentence the merchant reads when reviewing this change.' },
      items: {
        type: 'array',
        required: true,
        description: 'One line per listing.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            listing_id: { type: 'string', required: true, description: 'Listing id returned by a commerce read.' },
            quantity: { type: 'integer', required: true, description: 'Units to add to the current stock.' },
          },
        },
      },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = stagingSession(ctx, exec, config)
        if ('outcome' in session) return session.outcome
        if (args.items.length === 0) return held('Provide at least one listing line, then retry.')
        /* jscpd:ignore-end */
        if (args.items.some(item => item.quantity < 1)) return held('Each restock quantity must be at least 1 unit. Correct it, then retry.')
        const ids = args.items.map(item => ListingId(item.listing_id))
        const unread = provenanceHeld(session.state, ids)
        if (unread !== undefined) return unread
        const family = familyHeld(await readListings(ctx, session.sourceId, ids, exec.signal), 'stocked')
        if (family !== undefined) return family
        const stock = new Map((await ctx.commerce.inventoryHealth(session.sourceId, exec.signal)).items
          .map(item => [item.listingId, item.available]))
        const missing = [...new Set(ids)].filter(id => !stock.has(id))
        if (missing.length > 0) {
          return gateHeld(
            'inventory',
            `listing ids ${idList(missing)} have no row in the imported inventory table`,
            'Import an inventory table that includes them, or restock only listings that have inventory rows.',
          )
        }
        const items = args.items.map((item): StagedChangeItem => {
          const listingId = ListingId(item.listing_id)
          const available = stock.get(listingId) ?? 0
          return { listingId, field: 'available', before: available, after: available + item.quantity }
        })
        return stage(session.state, 'restock', args.summary, items, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_stage_campaign',
    description: 'Stage a new dated marketing campaign with a budget for merchant review. Staging changes nothing in the store.',
    parameters: {
      summary: { type: 'string', required: true, description: 'One sentence the merchant reads when reviewing this change.' },
      name: { type: 'string', required: true, description: 'Campaign name.' },
      budget: { type: 'number', required: true, description: 'Total campaign budget in the store currency.' },
      starts_on: { type: 'string', required: true, description: 'First campaign day, YYYY-MM-DD.' },
      ends_on: { type: 'string', required: true, description: 'Last campaign day, YYYY-MM-DD.' },
      listing_ids: { type: 'array', required: true, description: 'Listing ids the campaign promotes, returned by a commerce read; may be empty.', items: { type: 'string' } },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(() => {
        const session = stagingSession(ctx, exec, config)
        if ('outcome' in session) return session.outcome
        const name = args.name.trim()
        if (name === '') return held('The campaign needs a name. Provide one, then retry.')
        if (args.budget <= 0) return held('The campaign budget must be a positive amount. Correct it, then retry.')
        const dates = windowHeld(args.starts_on, args.ends_on)
        if (dates !== undefined) return dates
        const ids = [...new Set(args.listing_ids.map(id => ListingId(id)))]
        const unread = provenanceHeld(session.state, ids)
        if (unread !== undefined) return unread
        const items: StagedChangeItem[] = [{ listingId: null, field: 'budget', before: null, after: args.budget }]
        return stage(session.state, 'campaign', args.summary, items, config, {
          window: { startsOn: args.starts_on, endsOn: args.ends_on },
          campaign: { name: shorten(name, CAMPAIGN_NAME_CHARS), listingIds: ids },
        })
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_discard_change',
    description: 'Discard one staged change so it is not exported. The change stays in the session ledger as discarded.',
    parameters: {
      change_id: { type: 'string', required: true, description: 'Change id returned by a staging tool.' },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(() => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        const change = session.state.ledger.find(entry => entry.id === args.change_id)
        if (change === undefined) {
          return gateHeld(
            'ledger',
            `change ${label(args.change_id)} was not staged in this session, so there is nothing to discard`,
            'Use a change id returned by a staging tool.',
          )
        }
        if (change.status !== 'staged') return held(`Change ${change.id} is already ${change.status}; nothing to discard.`)
        return ok({ id: change.id, status: 'discarded', summary: change.summary }, [], false, config, {
          lead: `Discarded ${change.id}. It stays in the session ledger and will not be exported.`,
          discardedChangeId: change.id,
        })
      }, config)
    },
  }))
}
