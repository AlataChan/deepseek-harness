/** Commerce staging tools: each gate held beside a should-serve counterpart, provider-grounded before values, and the session ledger. */

import { afterEach, describe, expect, it } from 'vitest'
import { ChangeId, ListingId } from '@deepseek-ai/dsh-host-commerce'
import type { ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { StagedChange } from '../../src/tools/types.ts'
import { bench, call, callRecorded, disposeBenches, recordRead, SOURCE_ID, text } from './bench.ts'

afterEach(disposeBenches)

async function boundBench(overrides: Parameters<typeof bench>[0] = {}) {
  const env = await bench({ maxMetaBytes: 8_192, ...overrides })
  await env.ctx.commerce.bind(env.owner, SOURCE_ID)
  env.commerce.listingRecords.set('P-1', {
    id: ListingId('P-1'), title: 'Tea', variantIds: [],
    values: { listing_id: 'P-1', title: 'Tea', description: 'Green tea', price: 10, status: 'active' },
  })
  env.commerce.listingRecords.set('FAM', {
    id: ListingId('FAM'), title: 'Cups', variantIds: [ListingId('FAM-S'), ListingId('FAM-L')],
    values: { listing_id: 'FAM', title: 'Cups', price: 20 },
  })
  env.commerce.listingRecords.set('FAM-S', {
    id: ListingId('FAM-S'), title: 'Small cup', parentId: ListingId('FAM'), variantIds: [],
    values: { listing_id: 'FAM-S', title: 'Small cup', price: 20 },
  })
  env.commerce.listingRecords.set('NOPRICE', {
    id: ListingId('NOPRICE'), title: 'Mystery', variantIds: [], values: { listing_id: 'NOPRICE', title: 'Mystery', price: null },
  })
  env.commerce.inventoryItems = [{ listingId: ListingId('P-1'), available: 5, status: 'healthy' }]
  return env
}

function ledger(env: Awaited<ReturnType<typeof boundBench>>): readonly StagedChange[] {
  return env.ctx.sessionProjections.stateOf(env.owner.session, 'commerceSession')?.ledger ?? []
}

const priceArgs = { summary: 'Raise tea price', items: [{ listing_id: 'P-1', price: 11 }] }

describe('commerce staging tools', () => {
  it('holds parented, ownerless, and unbound staging calls', async () => {
    const env = await bench({ maxMetaBytes: 8_192 })
    const parent = Symbol('parent') as ToolExecutionToken
    expect(text(await call(env.ctx, 'commerce_stage_price_change', priceArgs, env.owner, parent))).toContain('direct calls')
    expect(text(await call(env.ctx, 'commerce_stage_price_change', priceArgs))).toContain('active agent session')
    expect(text(await call(env.ctx, 'commerce_stage_price_change', priceArgs, env.owner))).toContain('No commerce source is bound')
  })

  it('holds an unread listing and stages a read one with its provider-grounded price', async () => {
    const env = await boundBench()
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs)))
      .toContain('Held by the provenance gate: listing ids P-1 were not returned by a commerce read in this session.')
    expect(ledger(env)).toEqual([])
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    const staged = await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs)
    expect(text(staged)).toMatch(/^Staged chg-0001 for review only\./u)
    expect(text(staged)).toContain('<external-data>')
    expect(ledger(env)).toEqual([{
      id: ChangeId('chg-0001'), kind: 'price-change', summary: 'Raise tea price', status: 'staged',
      items: [{ listingId: ListingId('P-1'), field: 'price', before: 10, after: 11 }],
    }])
  })

  it('numbers changes by ledger order, bounds the ledger, and still discards when full', async () => {
    const env = await boundBench({ maxStagedChanges: 2 })
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs))).toMatch(/^Staged chg-0001/u)
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs))).toMatch(/^Staged chg-0002/u)
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs)))
      .toContain('Held by the ledger gate: this session\'s ledger already holds 2 changes, its configured limit.')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_discard_change', { change_id: 'chg-0001' })))
      .toMatch(/^Discarded chg-0001\./u)
    expect(ledger(env).map(change => change.status)).toEqual(['discarded', 'staged'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_discard_change', { change_id: 'chg-0001' })))
      .toBe('Change chg-0001 is already discarded; nothing to discard.')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_discard_change', { change_id: 'chg-0404' })))
      .toContain('Held by the ledger gate: change chg-0404 was not staged in this session')
  })

  it('requires a full listing read for a content edit and names the listing fields', async () => {
    const env = await boundBench()
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    const args = { listing_id: 'P-1', summary: 'Clearer title', fields: [{ field: 'title', value: 'Jasmine green tea' }] }
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_listing_update', args)))
      .toContain('Held by the record-read gate: a content edit to P-1 needs the full listing record.')
    recordRead(env.owner, 'commerce_get_listing', ['P-1'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_listing_update', { ...args, fields: [{ field: 'colour', value: 'green' }] })))
      .toContain('colour is not a listing field. Listing fields are listing_id, title, description, price, status')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_listing_update', { ...args, fields: [{ field: 'price', value: '12' }] })))
      .toContain("'price' cannot be changed through a listing update")
    const staged = await callRecorded(env.ctx, env.owner, 'commerce_stage_listing_update', args)
    expect(staged.meta).toMatchObject({
      staged: { id: 'chg-0001', kind: 'listing-update', items: [{ listingId: 'P-1', field: 'title', before: 'Tea', after: 'Jasmine green tea' }] },
    })
  })

  it('points price changes on a listing with variants at its variant ids', async () => {
    const env = await boundBench()
    recordRead(env.owner, 'commerce_search_listings', ['FAM', 'FAM-S'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', { summary: 'Cups', items: [{ listing_id: 'FAM', price: 21 }] })))
      .toContain('Held by the options gate: listing ids FAM have variants and are priced per variant; their variant ids are FAM-S, FAM-L.')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', { summary: 'Small cup', items: [{ listing_id: 'FAM-S', price: 21 }] })))
      .toMatch(/^Staged chg-0001/u)
  })

  it('holds price moves over the guardrail or without a grounded price', async () => {
    const env = await boundBench()
    recordRead(env.owner, 'commerce_search_listings', ['P-1', 'NOPRICE'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', { summary: 'Too much', items: [{ listing_id: 'P-1', price: 13 }] })))
      .toContain("Held by the guardrail gate: the change exceeds this store's guardrails: the price move of 30% on P-1 exceeds the 20% per-change limit.")
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', { summary: 'Unknown', items: [{ listing_id: 'NOPRICE', price: 5 }] })))
      .toContain('NOPRICE has no grounded current price')
    expect(ledger(env)).toEqual([])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', { summary: 'Within', items: [{ listing_id: 'P-1', price: 12 }] })))
      .toMatch(/^Staged chg-0001/u)
  })

  it('checks promotion dates and depth before reading listings and prices each line from the provider', async () => {
    const env = await boundBench()
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    const base = { summary: 'Autumn sale', listing_ids: ['P-1'], starts_on: '2026-10-01', ends_on: '2026-10-07' }
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_promotion', { ...base, discount_pct: 60 })))
      .toContain("Held by the guardrail gate: a 60% promotion exceeds this store's 50% promotion limit. Propose a shallower discount.")
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_promotion', { ...base, discount_pct: 10, ends_on: '2026-09-30' })))
      .toContain('starts_on must not be later than ends_on')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_promotion', { ...base, discount_pct: 10, starts_on: '2026-02-30' })))
      .toContain('calendar dates in YYYY-MM-DD form')
    expect(env.commerce.listingReads).toBe(0)
    const staged = await callRecorded(env.ctx, env.owner, 'commerce_stage_promotion', { ...base, discount_pct: 25 })
    expect(staged.meta).toMatchObject({
      staged: {
        kind: 'promotion', window: { startsOn: '2026-10-01', endsOn: '2026-10-07' },
        items: [{ listingId: 'P-1', field: 'promotion_price', before: 10, after: 7.5 }],
      },
    })
  })

  it('grounds restocks in the inventory table and caps the added quantity', async () => {
    const env = await boundBench()
    recordRead(env.owner, 'commerce_inventory_health', ['P-1', 'NOPRICE'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_restock', { summary: 'Restock', items: [{ listing_id: 'NOPRICE', quantity: 10 }] })))
      .toContain('Held by the inventory gate: listing ids NOPRICE have no row in the imported inventory table.')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_restock', { summary: 'None', items: [{ listing_id: 'P-1', quantity: 0 }] })))
      .toContain('at least 1 unit')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_restock', { summary: 'Too many', items: [{ listing_id: 'P-1', quantity: 501 }] })))
      .toContain('restocking 501 units on P-1 exceeds the 500-unit per-change limit')
    const staged = await callRecorded(env.ctx, env.owner, 'commerce_stage_restock', { summary: 'Restock tea', items: [{ listing_id: 'P-1', quantity: 20 }] })
    expect(staged.meta).toMatchObject({
      staged: { kind: 'restock', items: [{ listingId: 'P-1', field: 'available', before: 5, after: 25 }] },
    })
  })

  it('checks campaign listing provenance and caps the budget', async () => {
    const env = await boundBench()
    const base = { summary: 'Tea week', name: 'Tea week', starts_on: '2026-10-01', ends_on: '2026-10-07', listing_ids: ['P-1'] }
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_campaign', { ...base, budget: 500 })))
      .toContain('Held by the provenance gate')
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_campaign', { ...base, budget: 10_001 })))
      .toContain('the campaign budget of 10001 exceeds the 10000 per-change limit')
    const staged = await callRecorded(env.ctx, env.owner, 'commerce_stage_campaign', { ...base, budget: 800 })
    expect(staged.meta).toMatchObject({
      staged: {
        kind: 'campaign', window: { startsOn: '2026-10-01', endsOn: '2026-10-07' },
        campaign: { name: 'Tea week', listingIds: ['P-1'] },
        items: [{ listingId: null, field: 'budget', before: null, after: 800 }],
      },
    })
  })

  it('holds a change whose metadata exceeds the byte cap without adding it to the ledger', async () => {
    const env = await boundBench({ maxMetaBytes: 64 })
    recordRead(env.owner, 'commerce_search_listings', ['P-1'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', priceArgs))).toContain('metadata exceeds')
    expect(ledger(env)).toEqual([])
  })
})
