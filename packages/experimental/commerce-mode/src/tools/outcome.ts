/** Commerce tool outcomes: held refusals, successful values, bounded rendering, metadata, and Provider-failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CommerceError,
  type ChangeId,
  type CommerceAnalysisSchema,
  type ListingId,
} from '@deepseek-ai/dsh-host-commerce'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { COMMERCE_TRUNCATION_SUFFIX, MIN_RESULT_CHARS, renderCommerceText } from './render.ts'

// Type-only import installs the projection declarations `binding` reads.
import type {} from '@deepseek-ai/dsh-session-projection'

/** Result and metadata bounds every commerce tool enforces. */
export interface OutcomeBounds {
  /** Maximum characters in one complete rendered result. */
  readonly maxResultChars: number
  /** Maximum listing ids persisted in one result metadata record. */
  readonly maxListingIds: number
  /** Maximum UTF-8 bytes in serialized result metadata. */
  readonly maxMetaBytes: number
}

/** Tool value before rendering: a successful value or a held refusal. */
export type ToolOutcome = {
  readonly status: 'ok'
  /** Harness text rendered unfenced before the fenced value. */
  readonly lead?: string
  readonly text: string
  readonly listingIds: ListingId[]
  readonly fullListing: boolean
  /** JSON form of the change a staging tool recorded. */
  readonly staged?: Record<string, JsonValue>
  readonly discardedChangeId?: ChangeId
  readonly exportedChangeIds?: ChangeId[]
  readonly exportPath?: string
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
      lead: { type: 'string' },
      text: { type: 'string', required: true },
      listingIds: { type: 'array', required: true, items: { type: 'string' } },
      fullListing: { type: 'boolean', required: true },
      staged: { type: 'object', additionalProperties: true },
      discardedChangeId: { type: 'string' },
      exportedChangeIds: { type: 'array', items: { type: 'string' } },
      exportPath: { type: 'string' },
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

/**
 * Build a held refusal.
 * @param message - model-facing reason and recovery step.
 * @returns the held outcome.
 */
export function held(message: string): ToolOutcome {
  return { status: 'held', message }
}

/**
 * Build a held refusal that names the gate which refused the call.
 * @param gate - gate name, such as provenance or guardrail.
 * @param reason - what the gate found.
 * @param recovery - the step that lets a retry pass.
 * @returns the held outcome.
 */
export function gateHeld(gate: string, reason: string, recovery: string): ToolOutcome {
  return held(`Held by the ${gate} gate: ${reason}. ${recovery}`)
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
  bounds: OutcomeBounds,
): ToolOutcome {
  const detailBudget = bounds.maxResultChars - introduction.length - recovery.length - 2
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
  bounds: OutcomeBounds,
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
          return recoverCommerceFailure(schemaError, bounds)
        }
      }
      const detail = JSON.stringify({ message: error.message, ...(schema === undefined ? {} : { schema }) }, null, 2)
      return heldWithDetail(
        `The analysis query was rejected by rule ${ruleId}: ${meaning}. Provider detail:`,
        detail,
        'Rewrite it as one read-only SELECT or WITH statement.',
        bounds,
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
        bounds,
      )
    case 'source-invalid':
      return held('The commerce source bound to this session can no longer be read. Import the files again in a new session.')
    case 'source-missing':
      if (error.details.ruleId === 'listing-id') {
        return held('A listing named in this call is not in the bound commerce source. Search the listings again and use current ids.')
      }
      return held('The commerce source bound to this session is no longer available. Import the files again in a new session.')
    default:
      throw error
  }
}

/**
 * Run a tool body and turn recoverable Provider refusals into held results; other failures stay errors.
 * @param operation - the tool body, synchronous or asynchronous.
 * @param bounds - result bounds for refusal detail.
 * @param analysisSchema - schema reader attached to a SQLite execution refusal.
 * @returns the body's outcome or the held refusal.
 */
export async function holdRecoverableFailure(
  operation: () => ToolOutcome | Promise<ToolOutcome>,
  bounds: OutcomeBounds,
  analysisSchema?: () => Promise<CommerceAnalysisSchema>,
): Promise<ToolOutcome> {
  try {
    return await operation()
  } catch (error: unknown) {
    return recoverCommerceFailure(error, bounds, analysisSchema)
  }
}

/**
 * Require a direct root call with an active agent.
 * @param exec - tool run context.
 * @returns the calling agent, or the held refusal.
 */
export function directCall(exec: ToolRunContext): { outcome: ToolOutcome } | { agent: Agent } {
  if (exec.parent !== undefined) {
    return { outcome: held('Commerce tools run as direct calls. Call this tool directly instead of from run_code.') }
  }
  if (exec.agent === undefined) {
    return { outcome: held('This commerce tool needs an active agent session. Start or resume a commerce session, then call it directly.') }
  }
  return { agent: exec.agent }
}

/**
 * Refusal for a read or write before the session is bound.
 * @returns the held outcome.
 */
export function unbound(): ToolOutcome {
  return held('No commerce source is bound to this session. Call commerce_import_file or commerce_load_sample first.')
}

function projectMeta(value: ToolOutcome) {
  if (value.status !== 'ok') return {}
  return {
    listingIds: value.listingIds,
    fullListing: value.fullListing,
    ...(value.staged === undefined ? {} : { staged: value.staged }),
    ...(value.discardedChangeId === undefined ? {} : { discardedChangeId: value.discardedChangeId }),
    ...(value.exportedChangeIds === undefined ? {} : { exportedChangeIds: value.exportedChangeIds }),
    ...(value.exportPath === undefined ? {} : { exportPath: value.exportPath }),
  }
}

/**
 * Build a successful outcome, holding it when its metadata exceeds the byte cap.
 * @param value - Provider or change value rendered as fenced JSON.
 * @param listingIds - listing ids the result contributes to read provenance.
 * @param fullListing - whether the result is a complete listing record.
 * @param bounds - listing-id and metadata caps.
 * @param extra - unfenced lead text and ledger metadata.
 * @returns the successful outcome, or the metadata-cap refusal.
 */
export function ok(
  value: unknown,
  listingIds: readonly ListingId[],
  fullListing: boolean,
  bounds: OutcomeBounds,
  extra: {
    readonly lead?: string
    readonly staged?: Record<string, JsonValue>
    readonly discardedChangeId?: ChangeId
    readonly exportedChangeIds?: ChangeId[]
    readonly exportPath?: string
  } = {},
): ToolOutcome {
  const outcome: ToolOutcome = {
    status: 'ok',
    ...extra,
    text: JSON.stringify(value, null, 2),
    listingIds: [...new Set(listingIds)].slice(0, bounds.maxListingIds),
    fullListing,
  }
  if (Buffer.byteLength(JSON.stringify(projectMeta(outcome)), 'utf8') > bounds.maxMetaBytes) {
    return held('The commerce result metadata exceeds the configured safety limit. Narrow the request and try again.')
  }
  return outcome
}

function render(value: ToolOutcome, bounds: OutcomeBounds): { type: 'text'; text: string }[] {
  if (value.status === 'held') return [{ type: 'text', text: boundText(value.message, bounds.maxResultChars) }]
  if (value.lead === undefined) return [{ type: 'text', text: renderCommerceText(value.text, bounds.maxResultChars) }]
  const valueBudget = bounds.maxResultChars - value.lead.length - 1
  return [{
    type: 'text',
    text: valueBudget < MIN_RESULT_CHARS
      ? boundText(value.lead, bounds.maxResultChars)
      : `${value.lead}\n${renderCommerceText(value.text, valueBudget)}`,
  }]
}

/**
 * Output declaration shared by every commerce tool.
 * @param bounds - result and metadata bounds.
 * @returns schema, renderer, and presentation metadata projection.
 */
export function outputFor(bounds: OutcomeBounds) {
  return {
    schema: outcomeSchema,
    render: (_args: unknown, value: ToolOutcome) => render(value, bounds),
    presentationMeta: (_args: unknown, value: ToolOutcome) => projectMeta(value),
  }
}

/**
 * Read the session's commerce binding.
 * @param ctx - context holding the session projection registry.
 * @param agent - calling agent.
 * @returns the binding, or null before binding.
 */
export function binding(ctx: Context, agent: Agent) {
  return ctx.sessionProjections.stateOf(agent.session, 'commerceBinding') ?? null
}
