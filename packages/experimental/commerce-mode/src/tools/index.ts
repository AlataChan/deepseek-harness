/** Native commerce import and read tools scoped to the commerce agent preset. */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CommerceError,
  ListingId,
  type CommerceAnalysisSchema,
} from '@deepseek-ai/dsh-host-commerce'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { commerceSessionProjectionDefinition } from './projection.ts'
import { COMMERCE_TRUNCATION_SUFFIX, MIN_RESULT_CHARS, renderCommerceText } from './render.ts'

// Type-only imports install the Context service and projection declarations.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session-projection'

export type * from './types.ts'
export { commerceSessionProjectionDefinition } from './projection.ts'

/** Loader-facing plugin name. */
export const name = 'commerce-tools'
/** Services required by the commerce tool Consumer. */
export const inject = ['commerce', 'fs', 'tools', 'sessionProjections']

/** Host service each tool mount claims so one Host cannot expose two mounts. */
const TOOL_MOUNT_SERVICE = 'commerceToolMount'

/** Deployment bounds for commerce tool inputs, outputs, and provenance. */
export interface Config {
  /** Maximum characters in one complete fenced Provider render. */
  readonly maxResultChars: number
  /** Maximum listing ids persisted in one tool-result metadata record. */
  readonly maxListingIds: number
  /** Maximum UTF-8 bytes in serialized presentation metadata. */
  readonly maxMetaBytes: number
  /** Maximum bytes read from one workspace import file. */
  readonly maxImportBytes: number
}

/** Schemastery validation for the required commerce tool bounds. */
export const Config: z<Config> = z.object({
  maxResultChars: z.number().step(1).min(MIN_RESULT_CHARS).required(),
  maxListingIds: z.number().step(1).min(1).required(),
  maxMetaBytes: z.number().step(1).min(2).required(),
  maxImportBytes: z.number().step(1).min(1).required(),
})

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/
type ToolOutcome = {
  readonly status: 'ok'
  readonly text: string
  readonly listingIds: ListingId[]
  readonly fullListing: boolean
} | {
  readonly status: 'held'
  readonly message: string
}

const outcomeSchema = {
  oneOf: [{
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', required: true, enum: ['ok'] },
      text: { type: 'string', required: true },
      listingIds: { type: 'array', required: true, items: { type: 'string' } },
      fullListing: { type: 'boolean', required: true },
    },
  }, {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', required: true, enum: ['held'] },
      message: { type: 'string', required: true },
    },
  }],
} as const

function held(message: string): ToolOutcome {
  return { status: 'held', message }
}

function boundText(text: string, maxResultChars: number): string {
  if (text.length <= maxResultChars) return text
  let kept = ''
  for (const codePoint of text) {
    if (kept.length + codePoint.length + COMMERCE_TRUNCATION_SUFFIX.length > maxResultChars) break
    kept += codePoint
  }
  return `${kept}${COMMERCE_TRUNCATION_SUFFIX}`
}

function heldWithDetail(
  introduction: string,
  detail: string,
  recovery: string,
  config: Config,
): ToolOutcome {
  const detailBudget = config.maxResultChars - introduction.length - recovery.length - 2
  if (detailBudget < MIN_RESULT_CHARS) {
    return held(`${introduction} ${recovery}`)
  }
  const rendered = renderCommerceText(detail, detailBudget)
  return held(`${introduction}\n${rendered}\n${recovery}`)
}

const ANALYSIS_RULE_MEANINGS: Readonly<Record<string, string>> = {
  empty: 'the query is empty',
  comments: 'SQL comments are not allowed',
  'multiple-statements': 'multiple statements were provided',
  'forbidden-keyword': 'the query contains a write or unsafe keyword',
  'select-only': 'the query is not a SELECT or WITH statement',
  'sqlite-execution': 'SQLite refused the query',
  'sqlite-json': 'SQLite returned invalid JSON',
}

async function recoverCommerceFailure(
  error: unknown,
  config: Config,
  analysisSchema?: () => Promise<CommerceAnalysisSchema>,
): Promise<ToolOutcome> {
  if (!(error instanceof CommerceError)) throw error
  switch (error.code) {
    case 'analysis-rejected': {
      const ruleId = error.details.ruleId ?? 'unknown'
      const meaning = ANALYSIS_RULE_MEANINGS[ruleId] ?? 'the provider rejected the query'
      let schema: CommerceAnalysisSchema | undefined
      if (ruleId === 'sqlite-execution' && analysisSchema !== undefined) {
        try {
          schema = await analysisSchema()
        } catch (schemaError: unknown) {
          return recoverCommerceFailure(schemaError, config)
        }
      }
      const detail = JSON.stringify({ message: error.message, ...(schema === undefined ? {} : { schema }) }, null, 2)
      return heldWithDetail(
        `The analysis query was rejected by rule ${ruleId}: ${meaning}. Provider detail:`,
        detail,
        'Rewrite it as one read-only SELECT or WITH statement.',
        config,
      )
    }
    case 'analysis-timeout':
      return held('The analysis query exceeded its time limit. Narrow it with filters, aggregation, or LIMIT, then retry.')
    case 'analysis-output-too-large':
      return held('The analysis query exceeded its output limit. Narrow it with filters, aggregation, or LIMIT, then retry.')
    case 'import-invalid':
      return heldWithDetail(
        'The commerce import is invalid. Provider detail:',
        error.message,
        'Choose a supported CSV or XLSX file and a configured platform, then retry.',
        config,
      )
    case 'source-invalid':
      return held('The commerce source bound to this session can no longer be read. Import the files again in a new session.')
    case 'source-missing':
      return held('The commerce source bound to this session is no longer available. Import the files again in a new session.')
    default:
      throw error
  }
}

async function holdRecoverableFailure(
  operation: () => Promise<ToolOutcome>,
  config: Config,
  analysisSchema?: () => Promise<CommerceAnalysisSchema>,
): Promise<ToolOutcome> {
  try {
    return await operation()
  } catch (error: unknown) {
    return recoverCommerceFailure(error, config, analysisSchema)
  }
}

function directCall(exec: ToolRunContext): { outcome: ToolOutcome } | { agent: Agent } {
  if (exec.parent !== undefined) {
    return { outcome: held('Commerce tools run as direct calls. Call this tool directly instead of from run_code.') }
  }
  if (exec.agent === undefined) {
    return { outcome: held('This commerce tool needs an active agent session. Start or resume a commerce session, then call it directly.') }
  }
  return { agent: exec.agent }
}

function unbound(): ToolOutcome {
  return held('No commerce source is bound to this session. Call commerce_import_file or commerce_load_sample first.')
}

function ok(value: unknown, listingIds: readonly ListingId[], fullListing: boolean, config: Config): ToolOutcome {
  const outcome: ToolOutcome = {
    status: 'ok',
    text: JSON.stringify(value, null, 2),
    listingIds: [...new Set(listingIds)].slice(0, config.maxListingIds),
    fullListing,
  }
  const meta = projectMeta(outcome)
  if (Buffer.byteLength(JSON.stringify(meta), 'utf8') > config.maxMetaBytes) {
    return held('The commerce result metadata exceeds the configured safety limit. Narrow the request and try again.')
  }
  return outcome
}

function projectMeta(value: ToolOutcome): { listingIds: ListingId[]; fullListing: boolean } | Record<string, never> {
  return value.status === 'ok'
    ? { listingIds: value.listingIds, fullListing: value.fullListing }
    : {}
}

function render(value: ToolOutcome, config: Config): { type: 'text'; text: string }[] {
  return [{
    type: 'text',
    text: value.status === 'held' ? boundText(value.message, config.maxResultChars) : renderCommerceText(value.text, config.maxResultChars),
  }]
}

function binding(ctx: Context, agent: Agent) {
  return ctx.sessionProjections.stateOf(agent.session, 'commerceBinding') ?? null
}

/**
 * Register the commerce projection and seven native tools on the current scope.
 * A Host accepts one mount: a second `./tools` or `./preset` mount fails at load.
 * @param ctx - root or preset-scope context holding the injected services.
 * @param config - tool input, output, and provenance bounds.
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

  const output = {
    schema: outcomeSchema,
    render: (_args: unknown, value: ToolOutcome) => render(value, config),
    presentationMeta: (_args: unknown, value: ToolOutcome) => projectMeta(value),
  }

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
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const current = binding(ctx, direct.agent)
        if (current === null) return unbound()
        if (args.limit < 1) return held('The listing limit must be positive. Retry with a positive limit.')
        const listings = await ctx.commerce.searchListings(current.sourceId, args, exec.signal)
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
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const current = binding(ctx, direct.agent)
        if (current === null) return unbound()
        const listing = await ctx.commerce.getListing(
          current.sourceId, ListingId(args.listing_id), exec.signal,
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
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const current = binding(ctx, direct.agent)
        if (current === null) return unbound()
        return ok(await ctx.commerce.salesSummary(current.sourceId, args, exec.signal), [], false, config)
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
        const direct = directCall(exec)
        if ('outcome' in direct) return direct.outcome
        const current = binding(ctx, direct.agent)
        if (current === null) return unbound()
        const health = await ctx.commerce.inventoryHealth(current.sourceId, exec.signal)
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
      const direct = directCall(exec)
      if ('outcome' in direct) return direct.outcome
      const current = binding(ctx, direct.agent)
      if (current === null) return unbound()
      const sourceId = current.sourceId
      return holdRecoverableFailure(async () => {
        const result = await ctx.commerce.runAnalysisQuery(sourceId, args.query, exec.signal)
        return ok(result, [], false, config)
      }, config, () => ctx.commerce.analysisSchema(sourceId, exec.signal))
    },
  }))
}
