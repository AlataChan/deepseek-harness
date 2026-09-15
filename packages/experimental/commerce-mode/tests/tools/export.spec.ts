/** Commerce export tool: ledger and staleness gates, metadata prevalidation, sandbox and target checks, and approval outcomes. */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ListingId } from '@deepseek-ai/dsh-host-commerce'
import * as CommerceTools from '../../src/tools/index.ts'
import { exportPathFor } from '../../src/tools/export.ts'
import {
  answerApprovals,
  bench,
  call,
  callRecorded,
  config,
  disposeBenches,
  openTurn,
  recordRead,
  SOURCE_ID,
  text,
} from './bench.ts'

afterEach(disposeBenches)

const exportArgs = { change_ids: ['chg-0001'], platform: 'sample' }
const exportPath = exportPathFor(['chg-0001'])

async function stagedBench(overrides: Parameters<typeof bench>[0] = {}) {
  const env = await bench({ maxMetaBytes: 8_192, ...overrides })
  await env.ctx.commerce.bind(env.owner, SOURCE_ID)
  env.commerce.listingRecords.set('P-1', {
    id: ListingId('P-1'), title: 'Tea', variantIds: [], values: { listing_id: 'P-1', title: 'Tea', price: 10 },
  })
  openTurn(env.owner)
  recordRead(env.owner, 'commerce_get_listing', ['P-1'])
  expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_price_change', {
    summary: 'Raise tea price', items: [{ listing_id: 'P-1', price: 11 }],
  }))).toMatch(/^Staged chg-0001/u)
  return env
}

type StagedBench = Awaited<ReturnType<typeof stagedBench>>

function ledgerStatuses(env: StagedBench) {
  return env.ctx.sessionProjections.stateOf(env.owner.session, 'commerceSession')?.ledger.map(change => change.status)
}

function approvalAsked(env: StagedBench): boolean {
  return env.owner.session.snapshotEvents().some(event => event.type === 'approval/asked')
}

function exportFile(env: StagedBench, path = exportPath): string {
  return join(env.root, path)
}

describe('commerce export tool', () => {
  it('writes the approved export under the session workspace and marks the change exported', async () => {
    const env = await stagedBench()
    answerApprovals(env.ctx, 'allowed-once')
    const result = await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)
    expect(text(result).startsWith(`Exported 1 staged change to ${exportPath}.`)).toBe(true)
    expect(result.meta).toMatchObject({ exportedChangeIds: ['chg-0001'], exportPath })
    expect(env.root).not.toBe(process.cwd())
    expect(await readFile(exportFile(env), 'utf8')).toBe('change_id,change_kind,listing_id,price\nchg-0001,price-change,P-1,11\n')
    expect(ledgerStatuses(env)).toEqual(['exported'])
    expect(approvalAsked(env)).toBe(true)
  })

  for (const [outcome, message] of [
    ['rejected', 'The merchant rejected the export, and nothing was written.'],
    ['cancelled', 'The export approval was cancelled, and nothing was written.'],
    ['unavailable', 'No one was available to approve the export, and nothing was written.'],
  ] as const) {
    it(`writes nothing when approval is ${outcome}`, async () => {
      const env = await stagedBench()
      if (outcome !== 'unavailable') answerApprovals(env.ctx, outcome)
      expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs))).toContain(message)
      expect(existsSync(exportFile(env))).toBe(false)
      expect(ledgerStatuses(env)).toEqual(['staged'])
    })
  }

  it('asks the merchant to switch permissions when approval prompts are disabled', async () => {
    const env = await stagedBench()
    env.owner.session.append('approval/policy', { policy: 'never' })
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)))
      .toContain('Approval prompts are disabled in this session, so the export was not written. Ask the merchant to switch Permissions to workspace-write, then export again.')
    expect(existsSync(exportFile(env))).toBe(false)
  })

  it('holds a call without an agent', async () => {
    const env = await stagedBench()
    expect(text(await call(env.ctx, 'commerce_export_changes', exportArgs))).toContain('active agent session')
  })

  it('holds missing, discarded, and already exported change ids', async () => {
    const env = await stagedBench()
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', { ...exportArgs, change_ids: ['chg-0404'] })))
      .toContain('Held by the ledger gate: change ids chg-0404 were not staged in this session.')
    answerApprovals(env.ctx, 'allowed-once')
    await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)))
      .toContain('Held by the ledger gate: changes chg-0001 (exported) are no longer staged.')

    const discarded = await stagedBench()
    await callRecorded(discarded.ctx, discarded.owner, 'commerce_discard_change', { change_id: 'chg-0001' })
    expect(text(await callRecorded(discarded.ctx, discarded.owner, 'commerce_export_changes', exportArgs)))
      .toContain('Held by the ledger gate: changes chg-0001 (discarded) are no longer staged.')
  })

  it('holds a change that no longer passes lowered guardrails before asking for approval', async () => {
    const env = await stagedBench()
    await env.fiber.dispose()
    await env.ctx.plugin(CommerceTools, Object.assign({}, config, {
      maxMetaBytes: 8_192, guardrails: { ...config.guardrails, maxPriceDeltaPct: 5 },
    }))
    answerApprovals(env.ctx, 'allowed-once')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)))
      .toContain("Held by the guardrail gate: the changes no longer pass this store's guardrails: chg-0001: the price move of 10% on P-1 exceeds the 5% per-change limit.")
    expect(approvalAsked(env)).toBe(false)
  })

  it('holds a change whose source before value changed after staging', async () => {
    const env = await stagedBench()
    env.commerce.listingRecords.set('P-1', {
      id: ListingId('P-1'), title: 'Tea', variantIds: [], values: { listing_id: 'P-1', title: 'Tea', price: 12 },
    })
    answerApprovals(env.ctx, 'allowed-once')
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)))
      .toContain('Held by the staleness gate: the bound source no longer matches the staged before values of chg-0001.')
    expect(approvalAsked(env)).toBe(false)
  })

  it('passes metadata at exactly maxMetaBytes and holds one byte over before any approval request', async () => {
    const metaBytes = Buffer.byteLength(JSON.stringify({
      listingIds: [], fullListing: false, exportedChangeIds: ['chg-0001'], exportPath,
    }), 'utf8')
    for (const [maxMetaBytes, exported] of [[metaBytes, true], [metaBytes - 1, false]] as const) {
      const env = await stagedBench()
      await env.fiber.dispose()
      await env.ctx.plugin(CommerceTools, Object.assign({}, config, { maxMetaBytes }))
      answerApprovals(env.ctx, 'allowed-once')
      const result = await callRecorded(env.ctx, env.owner, 'commerce_export_changes', exportArgs)
      expect(text(result).startsWith(exported ? 'Exported' : 'The commerce result metadata exceeds')).toBe(true)
      expect(existsSync(exportFile(env))).toBe(exported)
      expect(approvalAsked(env)).toBe(exported)
    }
  })

  it('holds a read-only session and an existing target before asking for approval', async () => {
    const readOnly = await stagedBench()
    readOnly.owner.session.append('sandbox/mode', { mode: 'read-only' })
    answerApprovals(readOnly.ctx, 'allowed-once')
    expect(text(await callRecorded(readOnly.ctx, readOnly.owner, 'commerce_export_changes', exportArgs)))
      .toContain("Held by the sandbox gate: this session's file policy does not allow writing the export into the workspace.")
    expect(approvalAsked(readOnly)).toBe(false)
    expect(existsSync(exportFile(readOnly))).toBe(false)

    const existing = await stagedBench()
    await mkdir(join(existing.root, 'commerce-exports'), { recursive: true })
    await writeFile(exportFile(existing), 'already here\n')
    answerApprovals(existing.ctx, 'allowed-once')
    expect(text(await callRecorded(existing.ctx, existing.owner, 'commerce_export_changes', exportArgs)))
      .toContain(`These changes may already be exported: ${exportPath} already exists, and nothing was written.`)
    expect(approvalAsked(existing)).toBe(false)
    expect(await readFile(exportFile(existing), 'utf8')).toBe('already here\n')
  })

  it('neutralizes formula-leading text cells in the written CSV', async () => {
    const env = await stagedBench()
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_stage_listing_update', {
      listing_id: 'P-1', summary: 'Link title', fields: [{ field: 'title', value: '=HYPERLINK("http://example.test")' }],
    }))).toMatch(/^Staged chg-0002/u)
    answerApprovals(env.ctx, 'allowed-once')
    const path = exportPathFor(['chg-0002'])
    expect(text(await callRecorded(env.ctx, env.owner, 'commerce_export_changes', { change_ids: ['chg-0002'], platform: 'sample' })))
      .toMatch(/^Exported 1 staged change/u)
    expect(await readFile(exportFile(env, path), 'utf8')).toContain('"\'=HYPERLINK(""http://example.test"")"')
  })
})
