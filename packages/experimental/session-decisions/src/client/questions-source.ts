/**
 * Client-side face of the `sessionDecisions` Remote namespace and the shared
 * per-apply source over it. The source only unwraps typed Remote results and
 * caches the per-Session catalog read for one refresh tick; every state and
 * admission decision stays server-owned.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertRemoteNamespaceMap, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated namespace declaration into the program for
// the compile-time wire assertion below; erased at runtime.
import type {} from '@deepseek-ai/dsh-experimental-session-decisions/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AnswerSubmitOutcome, DecisionId, DecisionView, RecordMutationOutcome } from '../types.ts'

/** Free-text answer payload; exclusive with a choice ordinal (Host-validated). */
export interface AnswerPayload {
  /** 1-based choice ordinal into {@link DecisionView.choices}. */
  readonly choiceOrdinal?: number
  /** Original free-human text, submitted verbatim. */
  readonly text?: string
}

/**
 * Internal narrow port of the mounted `sessionDecisions` namespace: the exact
 * method names and argument order the Web UI sends — the actual public
 * `@Remote` surface of `SessionDecisionsService`. When the Host owner adds
 * the generated `./remote` export, the mount must type-check this port against
 * (or derive it from) the actual generated namespace so a wire change fails
 * compilation, not just these tests.
 */
export interface SessionDecisionsRemote {
  catalog(sessionId: SessionId): Promise<RemoteResult<readonly DecisionView[]>>
  get(decisionId: DecisionId): Promise<RemoteResult<DecisionView | undefined>>
  submit(
    decisionId: DecisionId,
    expectedRevision: number,
    requestId: SessionRequestId,
    payload: AnswerPayload,
  ): Promise<RemoteResult<AnswerSubmitOutcome>>
  dismiss(decisionId: DecisionId, expectedRevision: number): Promise<RemoteResult<RecordMutationOutcome>>
  cancel(decisionId: DecisionId, expectedRevision: number): Promise<RemoteResult<RecordMutationOutcome>>
  pause(decisionId: DecisionId, expectedRevision: number, reason: string): Promise<RemoteResult<RecordMutationOutcome>>
  resume(decisionId: DecisionId, expectedRevision: number): Promise<RemoteResult<RecordMutationOutcome>>
}

/** The actual generated namespace of this package's Remote contribution. */
type GeneratedSessionDecisions = TypertRemoteNamespaceMap['sessionDecisions']

/**
 * Function-property view of a namespace, so function assignability is checked
 * strictly: interface method syntax is bivariant and would hide a parameter
 * change.
 */
type StrictFunctionsOf<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never }

/**
 * Compile-time wire assertion: the internal port stays satisfied by the
 * actual generated namespace, so a Host signature change fails compilation
 * here instead of only in the scripted tests.
 */
type PortSatisfiedByGenerated =
  StrictFunctionsOf<GeneratedSessionDecisions> extends StrictFunctionsOf<SessionDecisionsRemote> ? true : never
const portSatisfiedByGenerated: PortSatisfiedByGenerated = true
void portSatisfiedByGenerated

/** Error thrown when the mounted namespace rejects a call at the gateway. */
export class QuestionRemoteError extends Error {}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new QuestionRemoteError(result.error.message)
  return result.value
}

/** What the header card, the Session-row mark, and the tool card consume. */
export interface QuestionSource {
  /**
   * Read one Session's records through the mounted namespace, cached for the
   * current refresh tick. Rejects with {@link QuestionRemoteError} when the
   * namespace is absent or a call fails.
   * @param sessionId - Session whose records to read.
   * @param options - `fresh: true` bypasses the per-tick cache; every
   * post-mutation re-read passes it so it never resolves a pre-mutation
   * promise.
   * @returns the Session's records.
   */
  catalog(sessionId: SessionId, options?: { readonly fresh?: boolean }): Promise<readonly DecisionView[]>
  /**
   * Read one record through the mounted namespace.
   * @param decisionId - record to read.
   * @returns the record, or `undefined` when the Host does not know it.
   */
  get(decisionId: DecisionId): Promise<DecisionView | undefined>
  /**
   * Submit one answer with the record's own saved identity; the client
   * allocates nothing. Settling invalidates the catalog cache.
   * @param view - record the answer belongs to.
   * @param payload - choice ordinal or original free text.
   * @returns the typed Host outcome.
   */
  submit(view: DecisionView, payload: AnswerPayload): Promise<AnswerSubmitOutcome>
  /**
   * Close tracking of one unresolved answer (an open record whose admission
   * index is `submitting`, `needs_reconciliation`, or `withdrawn`). Settling
   * invalidates the catalog cache.
   * @param view - record to close.
   * @returns the typed Host mutation outcome.
   */
  dismiss(view: DecisionView): Promise<RecordMutationOutcome>
  /**
   * Cancel one unreserved open question (`answerIndex: 'none'`); the Host
   * refuses a cancel with an answer in progress. Settling invalidates the
   * catalog cache.
   * @param view - record to cancel.
   * @returns the typed Host mutation outcome.
   */
  cancel(view: DecisionView): Promise<RecordMutationOutcome>
  /**
   * Pause one open question; admission refuses until an explicit resume.
   * Settling invalidates the catalog cache.
   * @param view - record to pause.
   * @param reason - stable server-recorded pause reason.
   * @returns the typed Host mutation outcome.
   */
  pause(view: DecisionView, reason: string): Promise<RecordMutationOutcome>
  /**
   * Clear the user pause on one open question. Settling invalidates the
   * catalog cache.
   * @param view - record to resume.
   * @returns the typed Host mutation outcome.
   */
  resume(view: DecisionView): Promise<RecordMutationOutcome>
  /** Refresh tick: bumps on every invalidation so seats re-read their state. */
  readonly hooks: { readonly refresh: HostObservable<number> }
  /** Invalidate the cached catalog reads. */
  refresh(): void
  /** Stop the bounded refresh lifecycle. */
  dispose(): void
}

/** Source lifecycle options. */
export interface QuestionSourceOptions {
  /**
   * Milliseconds between bounded background refreshes of the mounted
   * namespace; `0` disables the poll (tests drive ticks directly). The
   * default keeps server-owned state and persisted clocks honest without a
   * forever-stale cache.
   */
  readonly pollMs?: number
}

/**
 * Build the shared Remote-backed source over the mounted namespace.
 * @param remote - the mounted `sessionDecisions` namespace, or `undefined`
 * when the composition mounts the UI without the feature Remote.
 * @param options - source lifecycle options.
 * @returns the shared source; {@link QuestionSource.dispose} stops its poll.
 */
export function createQuestionSource(
  remote: SessionDecisionsRemote | undefined,
  options: QuestionSourceOptions = {},
): QuestionSource {
  const tick = createSnapshotStore(0)
  const caches = new Map<SessionId, { readonly atTick: number; readonly read: Promise<readonly DecisionView[]> }>()
  const readCatalog = (sessionId: SessionId): Promise<readonly DecisionView[]> => {
    if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
    return remote.catalog(sessionId).then(unwrap)
  }
  const source: QuestionSource = {
    catalog(sessionId, options) {
      const cached = caches.get(sessionId)
      if (!(options?.fresh === true) && cached && cached.atTick === tick.getSnapshot()) return cached.read
      const read = readCatalog(sessionId)
      caches.set(sessionId, { atTick: tick.getSnapshot(), read })
      // A failed read is not retained: the next seat must retry the Host.
      read.catch(() => { if (caches.get(sessionId)?.read === read) caches.delete(sessionId) })
      return read
    },
    get(decisionId) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.get(decisionId).then(unwrap)
    },
    submit(view, payload) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.submit(view.decisionId, view.revision, view.requestId, payload).then(unwrap).finally(() => { source.refresh() })
    },
    dismiss(view) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.dismiss(view.decisionId, view.revision).then(unwrap).finally(() => { source.refresh() })
    },
    cancel(view) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.cancel(view.decisionId, view.revision).then(unwrap).finally(() => { source.refresh() })
    },
    pause(view, reason) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.pause(view.decisionId, view.revision, reason).then(unwrap).finally(() => { source.refresh() })
    },
    resume(view) {
      if (!remote) return Promise.reject(new QuestionRemoteError('The questions namespace is not mounted'))
      return remote.resume(view.decisionId, view.revision).then(unwrap).finally(() => { source.refresh() })
    },
    hooks: { refresh: tick },
    refresh() {
      caches.clear()
      tick.set(tick.getSnapshot() + 1)
    },
    dispose() {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    },
  }
  const pollMs = options.pollMs ?? 15_000
  let timer: ReturnType<typeof setInterval> | undefined
  if (pollMs > 0) timer = setInterval(() => { source.refresh() }, pollMs)
  return source
}
