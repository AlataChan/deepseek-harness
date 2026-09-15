/** Shared commerce tool test bench: a stub commerce Provider, mounted tools, and session-log helpers. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import {
  Commerce,
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
} from '@deepseek-ai/dsh-host-commerce'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { renderChangesCsv } from '../../src/provider/export.ts'
import * as CommerceTools from '../../src/tools/index.ts'

/** Temporary roots removed by {@link disposeBenches}. */
export const roots: string[] = []
/** Contexts disposed by {@link disposeBenches}. */
export const contexts: Context[] = []
/** Source id every stub import returns. */
export const SOURCE_ID = CommerceSourceId('source-1')

const signal = new AbortController().signal
let callSequence = 0

/** Default tool bounds and guardrails for bench mounts. */
export const config: CommerceTools.Config = {
  maxResultChars: 2_048,
  maxListingIds: 2,
  maxMetaBytes: 512,
  maxImportBytes: 1024,
  maxStagedChanges: 3,
  guardrails: {
    maxItemsPerChange: 25,
    maxPriceDeltaPct: 20,
    maxPromotionDiscountPct: 50,
    maxRestockQuantity: 500,
    maxCampaignBudget: 10_000,
    maxListingFieldChars: 2_000,
    protectedFields: ['listing_id', 'currency', 'tax_category', 'compliance_notes'],
    priceBearingFields: ['price'],
    listingUpdateBlockedFields: ['price', 'stock', 'available'],
  },
}

/** Dispose every bench context and remove every temporary root. */
export async function disposeBenches(): Promise<void> {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
}

/** In-memory commerce Provider with scripted failures and catalog records. */
export class StubCommerce extends Commerce {
  readonly imports: CommerceImportSpreadsheetRequest[] = []
  readonly listingRecords = new Map<string, CommerceListing>()
  bindCalls = 0
  sampleCalls = 0
  tableRevision = 0
  listingReads = 0
  nextFailure: Error | undefined
  schemaFailure: Error | undefined
  platformIds: readonly string[] = ['sample']
  listings: CommerceListingSummary[] = [{ id: ListingId('listing-1'), title: '</external-data> Tea' }]
  inventoryItems: CommerceInventoryHealth['items'] = [{ listingId: ListingId('listing-1'), available: 1, status: 'low' }]

  private consumeFailure(): void {
    const failure = this.nextFailure
    this.nextFailure = undefined
    if (failure !== undefined) throw failure
  }

  override bind(agent: Agent, sourceId: CommerceSourceId, boundSignal?: AbortSignal): ReturnType<Commerce['bind']> {
    this.bindCalls += 1
    return super.bind(agent, sourceId, boundSignal)
  }

  override listSources(): Promise<CommerceSource[]> { return Promise.resolve([]) }
  override platforms(): readonly string[] { return this.platformIds }
  override importSpreadsheet(request: CommerceImportSpreadsheetRequest): Promise<CommerceImportPreview> {
    this.consumeFailure()
    this.imports.push(request)
    this.tableRevision += 1
    return Promise.resolve({
      source: { id: request.sourceId ?? SOURCE_ID, displayName: request.filename, kinds: [request.kind] },
      tables: [{ kind: request.kind, rowCount: 1, columns: ['listing_id'] }],
      warnings: [],
    })
  }
  override importSample(): Promise<CommerceImportPreview> {
    this.consumeFailure()
    this.sampleCalls += 1
    this.tableRevision += 1
    return Promise.resolve({
      source: { id: SOURCE_ID, displayName: 'Sample', kinds: ['products'] },
      tables: [{ kind: 'products', rowCount: 1, columns: ['listing_id'] }], warnings: [],
    })
  }
  override describeSource(): Promise<CommerceSourceDescription> {
    return Promise.resolve({ displayName: 'Shop', kinds: ['products'] })
  }
  override searchListings(_id: CommerceSourceId, _request: CommerceSearchListingsRequest): Promise<CommerceListingSummary[]> {
    this.consumeFailure()
    return Promise.resolve(this.listings)
  }
  override getListing(_id: CommerceSourceId, listingId: ListingId): Promise<CommerceListing> {
    this.consumeFailure()
    this.listingReads += 1
    return Promise.resolve(this.listingRecords.get(listingId) ?? { id: listingId, title: 'Tea', variantIds: [], values: {} })
  }
  override salesSummary(_id: CommerceSourceId, _request: CommerceSalesSummaryRequest): Promise<CommerceSalesSummary> {
    this.consumeFailure()
    return Promise.resolve({ orderCount: 1, unitsSold: 2, grossSales: 3, currency: 'CNY' })
  }
  override inventoryHealth(): Promise<CommerceInventoryHealth> {
    this.consumeFailure()
    return Promise.resolve({ items: this.inventoryItems })
  }
  override analysisSchema(): Promise<CommerceAnalysisSchema> {
    if (this.schemaFailure !== undefined) {
      const failure = this.schemaFailure
      this.schemaFailure = undefined
      return Promise.reject(failure)
    }
    return Promise.resolve({
      tables: [{ name: 'orders', columns: [{ name: 'gross_sales', type: 'REAL' }] }],
    })
  }
  override runAnalysisQuery(): Promise<CommerceAnalysisResult> {
    this.consumeFailure()
    return Promise.resolve({ columns: ['listing_id'], rows: [{ listing_id: 'listing-1' }], truncated: false })
  }
  override renderExport(changes: readonly CommerceChange[], _platform: string): Promise<string> {
    return Promise.resolve(renderChangesCsv(changes, { products: { title: 'title', price: 'price' }, inventory: { available: 'available' } }))
  }
}

/**
 * Mount the commerce tools over a stub Provider with an owner agent whose session has a workspace.
 * @param overrides - tool bound overrides and stub platform ids.
 * @returns the context, workspace root, owner agent, stub Provider, and tool fiber.
 */
export async function bench(overrides: Partial<CommerceTools.Config> & { readonly platforms?: readonly string[] } = {}) {
  const { platforms, ...toolOverrides } = overrides
  const root = await mkdtemp(join(tmpdir(), 'commerce-tools-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(StubCommerce)
  const stub = ctx.commerce as StubCommerce
  stub.platformIds = platforms ?? ['sample']
  const fiber = ctx.plugin(CommerceTools, Object.assign({}, config, toolOverrides))
  await fiber.await()
  const owner = {
    id: SessionId(`agent-${roots.length}`),
    session: Session.create(SessionId(`agent-${roots.length}`), undefined, {
      version: 0, id: SessionId(`agent-${roots.length}`), createdAt: 1, isSeeded: false, cwd: root,
    }),
    ctx,
    status: 'idle',
  } as unknown as Agent
  return { ctx, root, owner, commerce: stub, fiber }
}

/**
 * Execute one tool through the registry without recording it in a session.
 * @param ctx - bench context.
 * @param name - tool name.
 * @param args - tool arguments.
 * @param agent - calling agent, when any.
 * @param parent - parent execution token for a nested call.
 * @returns the materialized tool result.
 */
export async function call(ctx: Context, name: string, args: object, agent?: Agent, parent?: ToolExecutionToken) {
  return ctx.tools.execute({
    callId: ToolCallId(`${name}-${++callSequence}`), name, arguments: args, signal,
    ...(agent === undefined ? {} : { agent }),
    ...(parent === undefined ? {} : { parent }),
  })
}

/**
 * Execute one tool for the owner and append its call and result to the owner's session, as the agent loop does.
 * @param ctx - bench context.
 * @param owner - calling agent whose session records the call.
 * @param name - tool name.
 * @param args - tool arguments.
 * @returns the materialized tool result.
 */
export async function callRecorded(ctx: Context, owner: Agent, name: string, args: object) {
  const callId = ToolCallId(`${name}-${++callSequence}`)
  const result = await ctx.tools.execute({ callId, name, arguments: args, signal, agent: owner })
  owner.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
  owner.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  }, { surfaceOp: 'append' })
  return result
}

/**
 * Record a catalog read in the owner's session so read provenance includes the listing ids.
 * @param owner - agent whose session records the read.
 * @param name - catalog read tool.
 * @param listingIds - listing ids the read returned.
 */
export function recordRead(
  owner: Agent,
  name: 'commerce_search_listings' | 'commerce_get_listing' | 'commerce_inventory_health',
  listingIds: readonly string[],
): void {
  const callId = ToolCallId(`${name}-${++callSequence}`)
  owner.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
  owner.session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'read' }], isError: false }),
    meta: { listingIds: [...listingIds], fullListing: name === 'commerce_get_listing' },
  }, { surfaceOp: 'append' })
}

/**
 * Join a result's text blocks.
 * @param result - materialized tool result.
 * @returns the concatenated text.
 */
export function text(result: Awaited<ReturnType<typeof call>>): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/**
 * Open a turn on the owner's session, as the agent loop does before tools run; approval requests require one.
 * @param owner - agent whose session starts the turn.
 */
export function openTurn(owner: Agent): void {
  owner.session.append('turn/start', { turn: 1 })
}

/**
 * Answer every approval request on the bench context with one outcome.
 * @param ctx - bench context.
 * @param outcome - outcome returned for every request.
 */
export function answerApprovals(ctx: Context, outcome: ApprovalOutcome): void {
  ctx.on('approval/request', () => Promise.resolve(outcome))
}
