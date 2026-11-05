/** Agent-owned model selection, its durable projection, and scoped switch notices.
 * @module @deepseek-ai/dsh-agent/model-selection
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Model, AgentOptions, PreStepDecision } from './runtime-types.ts'
import type { ModelSelection, ModelSelectionOrigin } from './types.ts'
import { boundContextSummary, createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import type { Session, EpochHeader } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

/**
 * Durable model-selection state for one Session. An effort the adapter
 * defaulted on a recorded request is omitted, so later requests resolve the
 * default again instead of pinning it as a choice.
 */
export interface ModelSelectionProjectionState {
  /** Selection used by the latest recorded model request. */
  readonly lastUsed: ModelSelection | null
  /** Later recorded selection not yet used by a matching model request. */
  readonly pending: ModelSelection | null
  /** Origin of `lastUsed`. Null means a request header recorded the route without a selection event. */
  readonly lastUsedOrigin: ModelSelectionOrigin | null
  /** Origin of `pending`. Null means no selection event is waiting. */
  readonly pendingOrigin: ModelSelectionOrigin | null
}

/**
 * Build a detached selection, omitting an absent effort.
 * @param provider - provider route.
 * @param model - provider-owned model id.
 * @param reasoningEffort - explicit effort; omission follows adapter defaults.
 * @returns a detached selection.
 */
function toSelection(provider: string, model: string, reasoningEffort: ReasoningEffortId | undefined): ModelSelection {
  return { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
}

/**
 * Compare provider and model without comparing reasoning effort.
 * @param left - first selection.
 * @param right - second selection.
 * @returns whether both selections name the same route.
 */
function sameRoute(left: ModelSelection, right: ModelSelection): boolean {
  return left.provider === right.provider && left.model === right.model
}

/**
 * Compare complete selections, treating absent effort as its own value.
 * @param left - first selection, or no recorded selection.
 * @param right - second selection, or no recorded selection.
 * @returns whether both selections agree.
 */
function sameModelSelection(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return left === right || (left !== null && right !== null
    && sameRoute(left, right) && left.reasoningEffort === right.reasoningEffort)
}

/** Absent and any value other than `inherited` are explicit. */
function originOf(origin: ModelSelectionOrigin | null | undefined): ModelSelectionOrigin {
  return origin === 'inherited' ? 'inherited' : 'explicit'
}

/** Selection a recorded request used, omitting an effort the adapter defaulted. */
function selectionOfHeader({ config, adapterDefaults }: EpochHeader): ModelSelection {
  return toSelection(config.provider, config.model, adapterDefaults?.reasoningEffort === true ? undefined : config.reasoningEffort)
}

const selectionSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).transform(ReasoningEffortId).exactOptional(),
}).nullable()

const originSchema = z.enum(['explicit', 'inherited']).nullable()

/**
 * Session selection fold: recorded selections become
 * the pending choice, and each request header retires a matching one.
 */
export const modelSelectionProjectionDefinition: Required<ProjectionDefinition<'modelSelection', ModelSelectionProjectionState>> = {
  key: 'modelSelection',
  stateVersion: 4,
  stateSchema: z.object({
    lastUsed: selectionSchema,
    pending: selectionSchema,
    lastUsedOrigin: originSchema,
    pendingOrigin: originSchema,
  }),
  init: () => ({ lastUsed: null, pending: null, lastUsedOrigin: null, pendingOrigin: null }),
  apply: (state, event) => {
    if (event.type === 'model/selection') {
      const selection = toSelection(event.data.provider, event.data.model, event.data.reasoningEffort)
      const origin = event.data.origin === 'inherited' ? 'inherited' : 'explicit'
      if (state.pending !== null && sameModelSelection(state.pending, selection) && originOf(state.pendingOrigin) === origin) return state
      return { ...state, pending: selection, pendingOrigin: origin }
    }
    if (event.type !== 'request/header') return state
    const lastUsed = selectionOfHeader(event.data.header)
    const matched = state.pending !== null && sameModelSelection(state.pending, lastUsed)
    const pending = matched ? null : state.pending
    const pendingOrigin = pending === null ? null : originOf(state.pendingOrigin)
    const storedLastOrigin = state.lastUsed === null ? null : (state.lastUsedOrigin ?? null)
    const lastUsedOrigin = matched
      ? originOf(state.pendingOrigin)
      : (sameModelSelection(state.lastUsed, lastUsed) ? storedLastOrigin : null)
    if (sameModelSelection(state.lastUsed, lastUsed) && pending === state.pending
      && lastUsedOrigin === storedLastOrigin
      && pendingOrigin === (state.pending === null ? null : originOf(state.pendingOrigin))) return state
    return { lastUsed, pending, lastUsedOrigin, pendingOrigin }
  },
  wire: {
    viewSchema: z.object({ lastUsed: selectionSchema, next: selectionSchema }),
    view: state => ({ lastUsed: state.lastUsed, next: state.pending ?? state.lastUsed }),
  },
}

/**
 * Read and record one Agent's model choices without resolving adapter defaults.
 * @param readState - driver-owned reader for this Session's selection projection.
 * @param session - Session receiving durable model selections.
 * @param options - live route fallback until a selection or request is recorded.
 */
export class AgentModel implements Model {
  constructor(
    private readonly readState: () => ModelSelectionProjectionState,
    private readonly session: Session,
    private readonly options: AgentOptions,
  ) {}

  current(): Readonly<ModelSelection> | undefined {
    const recorded = this.recordedSelection()
    if (recorded !== null) return { ...recorded }
    const { provider, model, reasoningEffort } = this.options
    return provider && model ? toSelection(provider, model, reasoningEffort) : undefined
  }

  /**
   * Origin of the recorded choice. Null means the route came from a request header or live options, not from a `model/selection` event.
   * @returns `explicit`, `inherited`, or null when no selection event is the current choice.
   */
  origin(): ModelSelectionOrigin | null {
    const state = this.readState()
    if (state.pending !== null) return originOf(state.pendingOrigin)
    if (state.lastUsed === null) return null
    return state.lastUsedOrigin ?? null
  }

  select(selection: Readonly<ModelSelection>, origin: ModelSelectionOrigin = 'explicit'): void {
    const next = toSelection(selection.provider, selection.model, selection.reasoningEffort)
    const state = this.readState()
    const recorded = state.pending ?? state.lastUsed
    const recordedOrigin = state.pending !== null
      ? originOf(state.pendingOrigin)
      : (state.lastUsed === null ? null : (state.lastUsedOrigin ?? null))
    if (recorded !== null && sameModelSelection(recorded, next) && recordedOrigin === origin) return
    const data = origin === 'inherited' ? { ...next, origin: 'inherited' as const } : next
    this.session.append('model/selection', data)
  }

  private recordedSelection(): ModelSelection | null {
    const state = this.readState()
    return state.pending ?? state.lastUsed
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'model-selection': { kind: 'model-selection' } & ContextFormed
  }
}

function routeLabel(route: ModelSelection, other: ModelSelection): string {
  return route.provider === other.provider ? route.model : `${route.provider}/${route.model}`
}

function modelSwitchNotice(previous: ModelSelection, selected: ModelSelection) {
  const from = routeLabel(previous, selected)
  const to = routeLabel(selected, previous)
  return createUserMessage({
    content: [{
      type: 'text',
      text: `[model changed: assistant turns above this point were generated by ${from}; the session continues with ${to}]`,
    }],
    source: {
      kind: 'model-selection',
      form: 'notice',
      summary: boundContextSummary(`${from} → ${to}`),
    },
  })
}

/**
 * Append a model-switch notice when the step's fixed route differs from the
 * last request header. Effort-only changes and empty no-request decisions add
 * no notice; a failure before header persistence repeats it on the next step.
 * Install in the selected Agent's unpublished setup scope.
 * @param agentCtx - The selected Agent's scoped context.
 * @returns Disposer for the scoped pre-step listener.
 */
export function installModelSelection(agentCtx: Context): () => void {
  return agentCtx.on(
    'agent/pre-step',
    async ({ agent, messages, signal, step, modelSelection }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      // The loop skips an empty first step and an emptied offered continuation.
      if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
      const previous = agent.session.requestHeader()?.config
      if (
        previous === undefined
        || (modelSelection.provider === previous.provider && modelSelection.model === previous.model)
      ) return decision
      return { ...decision, messages: [...decision.messages, modelSwitchNotice(previous, modelSelection)] }
    },
    { prepend: true },
  )
}
