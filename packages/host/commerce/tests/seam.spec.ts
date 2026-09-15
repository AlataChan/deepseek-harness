/** Service-owned commerce binding behavior and replay projection coverage. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  ChangeId,
  Commerce,
  CommerceError,
  CommerceSourceId,
  ListingId,
  type CommerceAnalysisResult,
  type CommerceAnalysisSchema,
  type CommerceChange,
  type CommerceImportPreview,
  type CommerceImportSpreadsheetRequest,
  type CommerceInventoryHealth,
  type CommerceListing,
  type CommerceListingSummary,
  type CommerceSalesSummary,
  type CommerceSalesSummaryRequest,
  type CommerceSearchListingsRequest,
  type CommerceSource,
  type CommerceSourceDescription,
} from '../src/index.ts'

const SOURCE_ID = CommerceSourceId('source-1')
const MISSING_SOURCE_ID = CommerceSourceId('missing')

function source(): CommerceSource {
  return {
    id: SOURCE_ID,
    displayName: 'Example shop',
    kinds: ['orders', 'products'],
  }
}

class StubCommerce extends Commerce {
  describeCalls = 0
  describeBarrier?: Promise<void>

  override listSources(_signal?: AbortSignal): Promise<CommerceSource[]> {
    return Promise.resolve([source()])
  }

  override platforms(): readonly string[] {
    return ['sample']
  }

  override importSpreadsheet(
    _request: CommerceImportSpreadsheetRequest,
    _signal?: AbortSignal,
  ): Promise<CommerceImportPreview> {
    return Promise.resolve({
      source: source(),
      tables: [{ kind: 'orders', rowCount: 1, columns: ['order_id'] }],
      warnings: [],
    })
  }

  override importSample(_signal?: AbortSignal): Promise<CommerceImportPreview> {
    return this.importSpreadsheet({
      kind: 'orders',
      platform: 'sample',
      filename: 'sample.csv',
      bytes: new Uint8Array(),
    })
  }

  override async describeSource(
    sourceId: CommerceSourceId,
    _signal?: AbortSignal,
  ): Promise<CommerceSourceDescription> {
    this.describeCalls += 1
    await this.describeBarrier
    if (sourceId === MISSING_SOURCE_ID) {
      throw new CommerceError('source-missing', `unknown source ${sourceId}`)
    }
    return { displayName: 'Example shop', kinds: ['orders', 'products'] }
  }

  override searchListings(
    _sourceId: CommerceSourceId,
    _request: CommerceSearchListingsRequest,
    _signal?: AbortSignal,
  ): Promise<CommerceListingSummary[]> {
    return Promise.resolve([])
  }

  override getListing(
    _sourceId: CommerceSourceId,
    _listingId: ListingId,
    _signal?: AbortSignal,
  ): Promise<CommerceListing> {
    return Promise.resolve({ id: ListingId('listing-1'), title: 'Example', variantIds: [], values: {} })
  }

  override salesSummary(
    _sourceId: CommerceSourceId,
    _request: CommerceSalesSummaryRequest,
    _signal?: AbortSignal,
  ): Promise<CommerceSalesSummary> {
    return Promise.resolve({ orderCount: 0, unitsSold: 0, grossSales: 0, currency: 'CNY' })
  }

  override inventoryHealth(
    _sourceId: CommerceSourceId,
    _signal?: AbortSignal,
  ): Promise<CommerceInventoryHealth> {
    return Promise.resolve({ items: [] })
  }

  override analysisSchema(
    _sourceId: CommerceSourceId,
    _signal?: AbortSignal,
  ): Promise<CommerceAnalysisSchema> {
    return Promise.resolve({ tables: [] })
  }

  override runAnalysisQuery(
    _sourceId: CommerceSourceId,
    _query: string,
    _signal?: AbortSignal,
  ): Promise<CommerceAnalysisResult> {
    return Promise.resolve({ columns: [], rows: [], truncated: false })
  }

  override renderExport(
    _changes: readonly CommerceChange[],
    _platform: string,
    _signal?: AbortSignal,
  ): Promise<string> {
    return Promise.resolve('')
  }
}

async function createBench(): Promise<{
  ctx: Context
  commerce: StubCommerce
  fiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = ctx.plugin(StubCommerce)
  await fiber.await()
  return { ctx, commerce: ctx.commerce as StubCommerce, fiber }
}

function agent(sessionId: string, seed?: Parameters<typeof Session.create>[1]): Agent {
  return { session: Session.create(SessionId(sessionId), seed) } as Agent
}

describe('Commerce seam', () => {
  it('binds once, appends one event, and returns the committed binding', async () => {
    const { commerce, fiber } = await createBench()
    const owner = agent('bind-once')

    const binding = await commerce.bind(owner, SOURCE_ID)

    expect(binding).toEqual({
      sourceId: CommerceSourceId('source-1'),
      displayName: 'Example shop',
      kinds: ['orders', 'products'],
    })
    expect(owner.session.snapshotEvents()).toHaveLength(1)
    expect(owner.session.snapshotEvents()[0]).toMatchObject({ type: 'commerce/bound', data: binding })
    await fiber.dispose()
  })

  it('rejects a second bind before source lookup and appends nothing', async () => {
    const { commerce, fiber } = await createBench()
    const owner = agent('already-bound')
    await commerce.bind(owner, SOURCE_ID)
    const eventsBefore = owner.session.snapshotEvents()

    await expect(commerce.bind(owner, SOURCE_ID)).rejects.toMatchObject({
      name: 'CommerceError',
      code: 'already-bound',
    })
    expect(commerce.describeCalls).toBe(1)
    expect(owner.session.snapshotEvents()).toEqual(eventsBefore)
    await fiber.dispose()
  })

  it('does not append when the source is missing', async () => {
    const { commerce, fiber } = await createBench()
    const owner = agent('missing-source')

    await expect(commerce.bind(owner, MISSING_SOURCE_ID)).rejects.toMatchObject({
      name: 'CommerceError',
      code: 'source-missing',
    })
    expect(owner.session.snapshotEvents()).toEqual([])
    await fiber.dispose()
  })

  it('commits only one of two concurrent binds', async () => {
    const { commerce, fiber } = await createBench()
    const owner = agent('concurrent-bind')
    let release!: () => void
    commerce.describeBarrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = commerce.bind(owner, SOURCE_ID)
    const second = commerce.bind(owner, SOURCE_ID)
    expect(commerce.describeCalls).toBe(2)

    release()
    const outcomes = await Promise.allSettled([first, second])

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find(outcome => outcome.status === 'rejected')).toMatchObject({
      reason: { name: 'CommerceError', code: 'already-bound' },
    })
    expect(owner.session.snapshotEvents()).toHaveLength(1)
    await fiber.dispose()
  })

  it('folds replayed commerce/bound events to the live binding', async () => {
    const { ctx, commerce, fiber } = await createBench()
    const owner = agent('live-fold')
    const binding = await commerce.bind(owner, SOURCE_ID)
    const replay = agent('replay-fold', owner.session.snapshotEvents())

    expect(ctx.sessionProjections.stateOf(owner.session, 'commerceBinding')).toEqual(binding)
    expect(ctx.sessionProjections.stateOf(replay.session, 'commerceBinding')).toEqual(binding)
    await fiber.dispose()
  })

  it('removes the service and projection registration with its fiber', async () => {
    const { ctx, fiber } = await createBench()
    const owner = agent('dispose')
    expect(ctx.get('commerce')).toBeInstanceOf(StubCommerce)
    expect(ctx.sessionProjections.stateOf(owner.session, 'commerceBinding')).toBeNull()

    await fiber.dispose()

    expect(ctx.get('commerce')).toBeUndefined()
    expect(ctx.sessionProjections.stateOf(owner.session, 'commerceBinding')).toBeUndefined()
  })

  it('brands the three opaque commerce ids and preserves error details', () => {
    expect(CommerceSourceId('source')).toBe('source')
    expect(ListingId('listing')).toBe('listing')
    expect(ChangeId('change')).toBe('change')
    const error = new CommerceError('analysis-rejected', 'unsafe query', { ruleId: 'select-only', limit: 1 })
    expect(error).toMatchObject({
      name: 'CommerceError',
      code: 'analysis-rejected',
      details: { ruleId: 'select-only', limit: 1 },
    })
    expect(new CommerceError('already-bound', 'bound').details).toEqual({})
  })
})
