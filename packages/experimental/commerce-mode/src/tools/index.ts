/** Native commerce import, read, staging, and export tools scoped to the commerce agent preset. */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ListingId } from '@deepseek-ai/dsh-host-commerce'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  binding,
  directCall,
  held,
  holdRecoverableFailure,
  ok,
  outputFor,
} from './outcome.ts'
import { commerceSessionProjectionDefinition } from './projection.ts'
import { MIN_RESULT_CHARS } from './render.ts'
import { registerExportTool } from './export.ts'
import { boundSession, registerStagingTools, type StagingConfig } from './staging.ts'

// Type-only imports install the Context service and projection declarations.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session-projection'

export type * from './types.ts'
export type { GuardrailConfig } from './guardrails.ts'
export type { OutcomeBounds } from './outcome.ts'
export type { StagingConfig } from './staging.ts'
export { commerceSessionProjectionDefinition } from './projection.ts'

/** Loader-facing plugin name. */
export const name = 'commerce-tools'
/** Services required by the commerce tool Consumer. */
export const inject = ['commerce', 'fs', 'tools', 'sessionProjections', 'approval', 'sandboxPolicy']

/** Host service each tool mount claims so one Host cannot expose two mounts. */
const TOOL_MOUNT_SERVICE = 'commerceToolMount'

/** Deployment bounds for commerce tool inputs, outputs, provenance, and staging. */
export interface Config extends StagingConfig {
  /** Maximum bytes read from one workspace import file. */
  readonly maxImportBytes: number
}

/** Schemastery validation for the required commerce tool bounds and guardrails. */
export const Config: z<Config> = z.object({
  maxResultChars: z.number().step(1).min(MIN_RESULT_CHARS).required(),
  maxListingIds: z.number().step(1).min(1).required(),
  maxMetaBytes: z.number().step(1).min(2).required(),
  maxImportBytes: z.number().step(1).min(1).required(),
  maxStagedChanges: z.number().step(1).min(1).required(),
  guardrails: z.object({
    maxItemsPerChange: z.number().step(1).min(1).required(),
    maxPriceDeltaPct: z.number().min(0).required(),
    maxPromotionDiscountPct: z.number().min(0).max(90).required(),
    maxRestockQuantity: z.number().step(1).min(1).required(),
    maxCampaignBudget: z.number().min(0).required(),
    maxListingFieldChars: z.number().step(1).min(1).required(),
    protectedFields: z.array(z.string()).required(),
    priceBearingFields: z.array(z.string()).required(),
    listingUpdateBlockedFields: z.array(z.string()).required(),
  }).required(),
})

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * Register the commerce projection with the import, read, staging, and export tools on the current scope.
 * A Host accepts one mount: a second `./tools` or `./preset` mount fails at load.
 * @param ctx - root or preset-scope context holding the injected services.
 * @param config - tool input, output, provenance, and staging bounds.
 */
export function apply(ctx: Context, config: Config): void {
  // Scopes share the root service store, so the second mount's claim throws.
  try {
    ctx.provide(TOOL_MOUNT_SERVICE, config)
  } catch (cause: unknown) {
    throw new Error(
      'commerce-mode: commerce tools are already mounted in this Host; add either the ./preset row or a root ./tools row, not both',
      { cause },
    )
  }
  ctx.sessionProjections.register(commerceSessionProjectionDefinition)

  const output = outputFor(config)

  ctx.tools.register(defineTool({
    name: 'commerce_import_file',
    description: 'Import or replace one commerce table from a regular spreadsheet file inside this session workspace.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative CSV or XLSX path.' },
      kind: { type: 'string', required: true, enum: ['orders', 'products', 'inventory'], description: 'Fixed table to replace.' },
      platform: { type: 'string', required: true, enum: [...ctx.commerce.platforms()], description: 'Configured source-platform mapping id.' },
    },
    output,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const workspace = direct.agent.session.header.cwd
        if (workspace === undefined) {
          return held('This session has no workspace. Start a session with a workspace, then call commerce_import_file.')
        }
        if (PARENT_PATH_SEGMENT.test(args.path)) {
          return held('The import path contains parent traversal. Choose a file inside the session workspace.')
        }
        const cwd = PARENT_PATH_SEGMENT.test(workspace) ? canonicalPath(workspace) : workspace
        const root = await ctx.fs.resolve(cwd, { signal: exec.signal })
        const pathInfo = await ctx.fs.lstat(args.path, { cwd }, exec.signal)
        if (pathInfo?.type === 'symlink') {
          return held('The import path is a symbolic link. Choose a regular file inside the session workspace.')
        }
        const target = await ctx.fs.resolve(args.path, { cwd, signal: exec.signal })
        if (!ctx.fs.contains(root, target)) {
          return held('The import path is outside the session workspace. Choose a file inside the session workspace.')
        }
        const info = await ctx.fs.stat(target, exec.signal)
        if (info?.type !== 'file') {
          return held('The import path is not a regular file. Choose a regular CSV or XLSX file inside the session workspace.')
        }
        const current = binding(ctx, direct.agent)
        const preview = await ctx.commerce.importSpreadsheet({
          ...(current === null ? {} : { sourceId: current.sourceId }),
          kind: args.kind,
          platform: args.platform,
          filename: basename(target.displayPath),
          bytes: await ctx.fs.readBytes(target, exec.signal, config.maxImportBytes),
        }, exec.signal)
        if (current === null) await ctx.commerce.bind(direct.agent, preview.source.id, exec.signal)
        return ok(preview, [], false, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_load_sample',
    description: 'Load the packaged fictional commerce sample into this session.',
    parameters: {},
    output,
    async execute(_args, exec) {
      return holdRecoverableFailure(async () => {
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const current = binding(ctx, direct.agent)
        if (current !== null) {
          return held(`This session is already bound to ${current.displayName}; loading the sample would replace its data. Start a new commerce session to use the sample.`)
        }
        const preview = await ctx.commerce.importSample(exec.signal)
        await ctx.commerce.bind(direct.agent, preview.source.id, exec.signal)
        return ok(preview, [], false, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_search_listings',
    description: 'Search product listings in the commerce source bound to this session.',
    parameters: {
      query: { type: 'string', description: 'Optional title or SKU search text.' },
      limit: { type: 'integer', required: true, description: 'Maximum listings to return.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        if (args.limit < 1) return held('The listing limit must be positive. Retry with a positive limit.')
        const listings = await ctx.commerce.searchListings(session.sourceId, args, exec.signal)
        return ok(listings, listings.map(listing => listing.id), false, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_get_listing',
    description: 'Read one complete product listing from the commerce source bound to this session.',
    parameters: {
      listing_id: { type: 'string', required: true, description: 'Opaque listing id returned by a commerce read.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        const listing = await ctx.commerce.getListing(
          session.sourceId, ListingId(args.listing_id), exec.signal,
        )
        return ok(listing, [listing.id], true, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_sales_summary',
    description: 'Read aggregate sales totals from the commerce source bound to this session.',
    parameters: {
      from: { type: 'string', description: 'Optional inclusive date lower bound.' },
      to: { type: 'string', description: 'Optional inclusive date upper bound.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        return ok(await ctx.commerce.salesSummary(session.sourceId, args, exec.signal), [], false, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_inventory_health',
    description: 'Read inventory health for listings in the commerce source bound to this session.',
    parameters: {},
    output,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return holdRecoverableFailure(async () => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        const health = await ctx.commerce.inventoryHealth(session.sourceId, exec.signal)
        return ok(health, health.items.map(item => item.listingId), false, config)
      }, config)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_analysis_query',
    description: 'Run one read-only SELECT or WITH query against the commerce source bound to this session.',
    parameters: {
      query: { type: 'string', required: true, description: 'One read-only SQLite SELECT or WITH statement.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const session = boundSession(ctx, exec)
      if ('outcome' in session) return session.outcome
      const sourceId = session.sourceId
      return holdRecoverableFailure(async () => {
        const result = await ctx.commerce.runAnalysisQuery(sourceId, args.query, exec.signal)
        return ok(result, [], false, config)
      }, config, () => ctx.commerce.analysisSchema(sourceId, exec.signal))
    },
  }))

  registerStagingTools(ctx, config)
  registerExportTool(ctx, config)
}
