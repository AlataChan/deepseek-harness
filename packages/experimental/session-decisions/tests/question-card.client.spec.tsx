// @vitest-environment jsdom
/**
 * The Session-header question card drives the real Remote namespace face: the
 * scripted namespace below is the exact SDK boundary production mounts, and
 * every assertion about submission reads the recorded wire arguments. A
 * changed `submit(decisionId, expectedRevision, requestId, payload)` signature,
 * a client-allocated request id, a second submission for one in-flight
 * answer, a close action the Host would refuse, or a stale Session A response
 * rendering under Session B fails here.
 */
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { bindSnapshotSelector,makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { afterEach,describe,expect,it,vi,type Mock } from 'vitest'
import { QuestionComposerCard } from '../src/client/QuestionComposerCard.tsx'
import { QuestionCard,type QuestionCardProps } from '../src/client/QuestionCard.tsx'
import { QuestionToolCard,type QuestionToolCardProps } from '../src/client/QuestionToolCard.tsx'
import { SessionQuestionMark,type SessionQuestionMarkProps } from '../src/client/SessionQuestionMark.tsx'
import { en,zh } from '../src/client/locales.ts'
import { closeActionFor, deriveStatus, pickOpenQuestion } from '../src/client/questions-state.ts'
import { createQuestionSource,type QuestionSource,type SessionDecisionsRemote } from '../src/client/questions-source.ts'
import type { AnswerSubmitOutcome,DecisionId,DecisionView,RecordMutationOutcome } from '../src/types.ts'

const SESSION = 'card-session' as SessionId
const SESSION_B = 'card-session-b' as SessionId
const DECISION = 'decision-1' as DecisionId
const REQUEST = 'request-1' as SessionRequestId

/** Session lifecycle selector used by the composer, with no background polling. */
function sessionHook(running: boolean): QuestionCardProps['useSession'] {
  const snapshot: SessionSnapshot = {
    sessionId: SESSION, running, pendingSubmissions: [], subagent: null,
    removed: false, openState: 'open', openError: null, hasMore: false,
    loadingOlder: false, promptError: null, blank: false, lastAgentError: null,
    promptAttempted: true, awaitingFirstTurn: false,
  }
  return select => select(snapshot)
}

/** One open, answerable record; individual tests override fields. */
function view(overrides: Partial<DecisionView> = {}): DecisionView {
  return {
    decisionId: DECISION,
    sessionId: SESSION,
    question: 'Which environment should I deploy to?',
    choices: ['Staging', 'Production'],
    createdAtUtc: '2026-11-04T00:00:00.000Z',
    expiresAtUtc: '2099-01-01T00:00:00.000Z',
    revision: 3,
    lifecycle: 'open',
    answerIndex: 'none',
    hasAnswer: false,
    requestId: REQUEST,
    suspended: false,
    ...overrides,
  }
}

type AnyOutcome = RemoteResult<unknown>

/**
 * Scripted spy types over the namespace face: the wire signature stays on the
 * mock, so async `mockImplementation` substitutes type-check instead of being
 * misread as void-returning callbacks.
 */
type ScriptedRemote = SessionDecisionsRemote & {
  catalog: Mock<(sessionId: SessionId) => Promise<AnyOutcome>>
  get: Mock<(decisionId: DecisionId) => Promise<AnyOutcome>>
  submit: Mock<() => Promise<AnyOutcome>>
  dismiss: Mock<() => Promise<AnyOutcome>>
  cancel: Mock<() => Promise<AnyOutcome>>
  pause: Mock<() => Promise<AnyOutcome>>
  resume: Mock<() => Promise<AnyOutcome>>
}

/**
 * Scripted `sessionDecisions` namespace: records every call and serves the
 * given results in order (the last one repeats), so a test scripts both the
 * initial state and the post-action refetch.
 */
function scriptRemote(results: {
  catalog?: readonly (readonly DecisionView[])[]
  get?: readonly (DecisionView | undefined)[]
  submit?: readonly AnswerSubmitOutcome[]
  dismiss?: readonly RecordMutationOutcome[]
  cancel?: readonly RecordMutationOutcome[]
  pause?: readonly RecordMutationOutcome[]
  resume?: readonly RecordMutationOutcome[]
  failGet?: boolean
} = {}): ScriptedRemote {
  const queue = <T,>(items: readonly T[] | undefined, fallback: T): (() => T) => {
    const rest = [...(items ?? [])]
    const list = items ?? [fallback]
    return () => {
      if (rest.length > 0) return rest.shift() as T
      // The last scripted result repeats: post-action re-reads (including the
      // mutation-invalidation tick) keep presenting the settled state.
      return list[list.length - 1] as T
    }
  }
  // Each dequeuer is created once; the last scripted result repeats so
  // post-action re-reads (including the mutation-invalidation tick) keep
  // presenting the settled state.
  const catalog = vi.fn((() => {
    const next = queue(results.catalog, [view()])
    return async (_sessionId: SessionId): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  const get = vi.fn((() => {
    const next = queue(results.get, view())
    return async (_decisionId: DecisionId): Promise<AnyOutcome> => {
      if (results.failGet === true) return { ok: false, error: { message: 'down' } as never }
      return { ok: true, value: next() }
    }
  })())
  const submit = vi.fn((() => {
    const next = queue(results.submit, { outcome: 'submitting', requestId: REQUEST })
    return async (): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  const dismiss = vi.fn((() => {
    const next = queue(results.dismiss, { ok: true, record: view() })
    return async (): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  const cancel = vi.fn((() => {
    const next = queue(results.cancel, { ok: true, record: view() })
    return async (): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  const pause = vi.fn((() => {
    const next = queue(results.pause, { ok: true, record: view() })
    return async (): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  const resume = vi.fn((() => {
    const next = queue(results.resume, { ok: true, record: view() })
    return async (): Promise<AnyOutcome> => ({ ok: true, value: next() })
  })())
  return { catalog, get, submit, dismiss, cancel, pause, resume } as never
}

/** Card props over one source built on the scripted namespace face. */
function cardProps(remote: SessionDecisionsRemote | undefined, sessionId: SessionId = SESSION): {
  props: QuestionCardProps
  source: QuestionSource
} {
  const source = createQuestionSource(remote, { pollMs: 0 })
  return {
    props: {
      sessionId,
      source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh),
      useSession: sessionHook(false),
      t: makeTranslate(zh),
    } as QuestionCardProps,
    source,
  }
}

async function openPanel(remote: ScriptedRemote = scriptRemote()): Promise<QuestionSource> {
  const { props, source } = cardProps(remote)
  render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  await screen.findByRole('dialog')
  return source
}

afterEach(cleanup)

describe('QuestionCard', () => {
  it('reads the Session catalog through the mounted namespace and presents the open question', async () => {
    const remote = scriptRemote()
    await openPanel(remote)
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalledWith(SESSION) })
    expect(screen.getByText(view().question)).toBeTruthy()
    for (const label of view().choices) expect(screen.getByRole('button', { name: label })).toBeTruthy()
  })

  it.each([
    ['in_flight', zh.notificationSending],
    ['sent', zh.notificationSent],
    ['failed', zh.notificationFailed],
    ['unknown', zh.notificationUnknown],
  ] as const)('shows the Host notification state %s independently of answer admission', async (notificationStatus, copy) => {
    await openPanel(scriptRemote({ catalog: [[view({ notificationStatus })]] }))
    expect(await screen.findByText(copy)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Staging' })).toBeTruthy()
  })

  it('renders the goal-stopped hint only for a derived active-but-disarmed Goal', async () => {
    const silent = scriptRemote({ catalog: [[view()]] })
    await openPanel(silent)
    await screen.findByText(view().question)
    expect(screen.queryByText(zh.goalHint)).toBeNull()
    cleanup()
    const disarmed = scriptRemote({ catalog: [[view({ goalDisarmed: true })]] })
    await openPanel(disarmed)
    expect(await screen.findByText(zh.goalHint)).toBeTruthy()
    cleanup()
    const pausedGoal = scriptRemote({ catalog: [[view({ goalDisarmed: false })]] })
    await openPanel(pausedGoal)
    await screen.findByText(view().question)
    expect(screen.queryByText(zh.goalHint)).toBeNull()
  })

  it('renders nothing while the namespace is unmounted (truthful unavailable header)', () => {
    const { props } = cardProps(undefined)
    const { container } = render(<QuestionCard {...props} />)
    expect(container.children).toHaveLength(0)
  })

  it('submits a choice with the record identity and a 1-based ordinal, then re-reads the Host', async () => {
    const remote = scriptRemote()
    await openPanel(remote)
    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    await waitFor(() => {
      expect(remote.submit).toHaveBeenCalledWith(DECISION, 3, REQUEST, { choiceOrdinal: 2 })
    })
    // The settled outcome re-reads the actual state instead of echoing acceptance:
    // the fresh post-action read bypasses the per-tick cache, and the mutation's
    // invalidation tick re-reads once more (mount + fresh + tick = 3 wire calls).
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalledTimes(3) })
  })

  it('submits the original free text verbatim', async () => {
    const remote = scriptRemote()
    await openPanel(remote)
    fireEvent.change(screen.getByPlaceholderText(zh.answerPlaceholder), { target: { value: '  Staging please  ' } })
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => {
      expect(remote.submit).toHaveBeenCalledWith(DECISION, 3, REQUEST, { text: '  Staging please  ' })
    })
  })

  it('does not send a second answer while one is in flight', async () => {
    let release: ((outcome: AnswerSubmitOutcome) => void) | undefined
    const remote = scriptRemote()
    remote.submit.mockImplementationOnce(() => new Promise<AnyOutcome>((resolve) => {
      release = (accepted) => { resolve({ ok: true, value: accepted }) }
    }))
    await openPanel(remote)
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(1) })
    const blocked = screen.getByRole('button', { name: 'Staging' }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    fireEvent.click(blocked)
    expect(remote.submit).toHaveBeenCalledTimes(1)
    release?.({ outcome: 'submitting', requestId: REQUEST })
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalledTimes(3) })
  })

  it('re-reads the Host after a typed rejection and shows the server-owned state, not an error of its own', async () => {
    const remote = scriptRemote({
      submit: [{ outcome: 'rejected', reason: 'DECISION_CONFLICT', message: 'conflict', requestId: REQUEST }],
      catalog: [[view()], [view({ answerIndex: 'submitting' })]],
    })
    await openPanel(remote)
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(screen.getByText(zh.submitting)).toBeTruthy() })
    expect(screen.queryByText(zh.rejected)).toBeNull()
  })

  it('presents the typed rejection while the record stays answerable', async () => {
    const remote = scriptRemote({
      submit: [{ outcome: 'rejected', reason: 'DECISION_LIMIT_EXCEEDED', message: 'too long', requestId: REQUEST }],
    })
    await openPanel(remote)
    fireEvent.change(screen.getByPlaceholderText(zh.answerPlaceholder), { target: { value: 'Way too long an answer' } })
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(screen.getByText(zh.rejected)).toBeTruthy() })
    // A rejection preserves the free-text draft; only a taken answer clears it.
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(zh.answerPlaceholder).value).toBe('Way too long an answer')
  })

  it('derives expiry from the persisted timestamp before the Host sweep runs', async () => {
    const remote = scriptRemote({ catalog: [[view({ expiresAtUtc: '2000-01-01T00:00:00.000Z' })]] })
    await openPanel(remote)
    expect(await screen.findByText(zh.expired)).toBeTruthy()
  })

  it('pauses an active question through the Host mutation', async () => {
    const paused = view({ suspended: true })
    const remote = scriptRemote({ catalog: [[view()], [paused]], pause: [{ ok: true, record: paused }] })
    await openPanel(remote)
    fireEvent.click(screen.getByRole('button', { name: zh.pause }))
    await waitFor(() => { expect(remote.pause).toHaveBeenCalledWith(DECISION, 3, 'user-requested') })
    expect(await screen.findByText(zh.paused)).toBeTruthy()
  })

  it('offers resume on a Host-owned paused question and no answer form', async () => {
    const active = view()
    const remote = scriptRemote({ catalog: [[view({ suspended: true })], [active]], resume: [{ ok: true, record: active }] })
    await openPanel(remote)
    expect(await screen.findByText(zh.paused)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.send })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.resume }))
    await waitFor(() => { expect(remote.resume).toHaveBeenCalledWith(DECISION, 3) })
    expect(await screen.findByRole('button', { name: zh.send })).toBeTruthy()
  })

  it('closes an unreserved question with cancel, never dismiss', async () => {
    const cancelled = view({ lifecycle: 'cancelled', closedAtUtc: '2026-11-04T01:00:00.000Z' })
    const remote = scriptRemote({ catalog: [[view()], [cancelled]], cancel: [{ ok: true, record: cancelled }] })
    await openPanel(remote)
    fireEvent.click(screen.getByRole('button', { name: zh.cancelQuestion }))
    // Two-step confirm; cancel here abandons the confirm, not the question.
    expect(screen.getByText(zh.cancelConfirm)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
    expect(remote.cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.cancelQuestion }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmCancel }))
    await waitFor(() => { expect(remote.cancel).toHaveBeenCalledWith(DECISION, 3) })
    expect(remote.dismiss).not.toHaveBeenCalled()
    expect(await screen.findByText(zh.cancelled)).toBeTruthy()
  })

  it('closes the tracking of an unresolved in-flight answer with dismiss, never cancel', async () => {
    const remote = scriptRemote({ catalog: [[view({ answerIndex: 'submitting' })]] })
    await openPanel(remote)
    expect(await screen.findByText(zh.submitting)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.cancelQuestion })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.stopTracking }))
    expect(screen.getByText(zh.stopTrackingConfirm)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.confirmStop }))
    await waitFor(() => { expect(remote.dismiss).toHaveBeenCalledWith(DECISION, 3) })
    expect(remote.cancel).not.toHaveBeenCalled()
  })

  it('offers no close or pause action once the answer is admitted', async () => {
    const remote = scriptRemote({ catalog: [[view({ answerIndex: 'admitted', hasAnswer: true })]] })
    await openPanel(remote)
    expect(await screen.findByText(zh.admitted)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.cancelQuestion })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.stopTracking })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.pause })).toBeNull()
  })

  it('keeps the record it acted on visible with its terminal state across poll refreshes until the panel closes', async () => {
    // A server-dismissed record is a tracking closure: cancelled lifecycle,
    // dismissed index and resolution kind — never an open record.
    const dismissed = view({ lifecycle: 'cancelled', answerIndex: 'dismissed', resolutionKind: 'dismissed' })
    const { props, source } = cardProps(scriptRemote({
      catalog: [[view({ answerIndex: 'submitting' })], [dismissed]],
      dismiss: [{ ok: true, record: dismissed }],
    }))
    render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: zh.stopTracking }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmStop }))
    expect(await screen.findByText(zh.dismissed)).toBeTruthy()
    expect(screen.queryByText(zh.cancelled)).toBeNull()
    // A poll refresh (tick) re-reads with no open record; the acted-on
    // terminal state must survive it while the panel is open.
    source.refresh()
    await waitFor(() => { expect(screen.getByText(zh.dismissed)).toBeTruthy() })
    // Closing the panel retires the closed record; the header seat unmounts.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('button', { name: zh.title })).toBeNull() })
  })

  it('focuses the dialog on open and returns focus to the trigger on Escape', async () => {
    await openPanel()
    const dialog = screen.getByRole('dialog') as HTMLElement
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.title }))
  })

  it('ignores a delayed Session A catalog response after switching to Session B', async () => {
    const remote = scriptRemote()
    const viewA = view({ decisionId: 'decision-a' as DecisionId, question: 'Question for session A' })
    const viewB = view({ decisionId: 'decision-b' as DecisionId, sessionId: SESSION_B, question: 'Question for session B' })
    let releaseA: ((views: readonly DecisionView[]) => void) | undefined
    let aCalls = 0
    remote.catalog.mockImplementation((sessionId: SessionId) => {
      if (sessionId === SESSION) {
        aCalls += 1
        // First read seeds the card; a later re-read hangs until released late.
        if (aCalls === 1) return Promise.resolve({ ok: true, value: [viewA] })
        return new Promise<AnyOutcome>((resolve) => { releaseA = (views) => { resolve({ ok: true, value: views }) } })
      }
      return Promise.resolve({ ok: true, value: [viewB] })
    })
    const { props } = cardProps(remote)
    const { rerender } = render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
    expect(await screen.findByText(viewB.question)).toBeTruthy()
    // Session A's delayed response lands after the switch and must be dropped.
    releaseA?.([viewA])
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalledWith(SESSION_B) })
    expect(screen.queryByText(viewA.question)).toBeNull()
    expect(screen.getByText(viewB.question)).toBeTruthy()
  })

  it('does not apply a settled Session A submission under Session B', async () => {
    const remote = scriptRemote()
    const viewA = view({ question: 'Question for session A' })
    const viewB = view({ decisionId: 'decision-b' as DecisionId, sessionId: SESSION_B, question: 'Question for session B' })
    remote.catalog.mockImplementation((sessionId: SessionId) => Promise.resolve({
      ok: true,
      value: [sessionId === SESSION ? viewA : viewB],
    }))
    let release: ((outcome: AnswerSubmitOutcome) => void) | undefined
    remote.submit.mockImplementationOnce(() => new Promise<AnyOutcome>((resolve) => {
      release = (outcome) => { resolve({ ok: true, value: outcome }) }
    }))
    const { props } = cardProps(remote)
    const { rerender } = render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(1) })
    rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
    expect(await screen.findByText(viewB.question)).toBeTruthy()
    release?.({ outcome: 'rejected', reason: 'DECISION_CONFLICT', message: 'late', requestId: REQUEST })
    await waitFor(() => { expect(screen.queryByText(zh.rejected)).toBeNull() })
    expect(screen.getByText(viewB.question)).toBeTruthy()
  })

  it('ignores a stale same-session catalog completion that resolves after a newer read', async () => {
    const dismissed = view({ lifecycle: 'cancelled', answerIndex: 'dismissed', resolutionKind: 'dismissed' })
    const remote = scriptRemote({ dismiss: [{ ok: true, record: dismissed }] })
    let releasePoll: ((views: readonly DecisionView[]) => void) | undefined
    let catalogCalls = 0
    remote.catalog.mockImplementation((_sessionId: SessionId) => {
      catalogCalls += 1
      if (catalogCalls === 1) return Promise.resolve({ ok: true, value: [view({ answerIndex: 'submitting' })] })
      if (catalogCalls === 2) {
        return new Promise<AnyOutcome>((resolve) => { releasePoll = (views) => { resolve({ ok: true, value: views }) } })
      }
      return Promise.resolve({ ok: true, value: [dismissed] })
    })
    const source = await openPanel(remote)
    await screen.findByText(zh.submitting)
    // A tick read (catalog call 2) starts and hangs before the dismissal.
    source.refresh()
    await waitFor(() => { expect(catalogCalls).toBe(2) })
    fireEvent.click(screen.getByRole('button', { name: zh.stopTracking }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmStop }))
    // The dismissal's fresh read (call 3) lands the terminal state first.
    expect(await screen.findByText(zh.dismissed)).toBeTruthy()
    // The pre-dismissal poll snapshot (call 2) settles last: it must not
    // overwrite the newer post-dismiss record.
    releasePoll?.([view({ answerIndex: 'submitting' })])
    await waitFor(() => { expect(screen.getByText(zh.dismissed)).toBeTruthy() })
    expect(screen.queryByText(zh.submitting)).toBeNull()
  })

  it('resets the action lock, draft, and confirm step when the Session switches', async () => {
    const remote = scriptRemote()
    const viewA = view({ question: 'Question for session A' })
    const viewB = view({ decisionId: 'decision-b' as DecisionId, sessionId: SESSION_B, question: 'Question for session B' })
    remote.catalog.mockImplementation((sessionId: SessionId) => Promise.resolve({
      ok: true,
      value: [sessionId === SESSION ? viewA : viewB],
    }))
    remote.submit.mockImplementationOnce(() => new Promise<AnyOutcome>(() => {}))
    const { props } = cardProps(remote)
    const { rerender } = render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    await screen.findByText(viewA.question)
    fireEvent.change(screen.getByPlaceholderText(zh.answerPlaceholder), { target: { value: 'draft from A' } })
    fireEvent.click(screen.getByRole('button', { name: zh.cancelQuestion }))
    expect(screen.getByText(zh.cancelConfirm)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.send }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(1) })
    // Session A's submission hangs forever; the switch to B must still leave
    // B fully answerable, with an empty draft and no inherited confirm step.
    rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
    expect(await screen.findByText(viewB.question)).toBeTruthy()
    expect(screen.queryByText(zh.cancelConfirm)).toBeNull()
    const staging = screen.getByRole('button', { name: 'Staging' }) as HTMLButtonElement
    expect(staging.disabled).toBe(false)
    expect(screen.getByPlaceholderText<HTMLTextAreaElement>(zh.answerPlaceholder).value).toBe('')
    fireEvent.click(staging)
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(2) })
  })

  it('does not land a Session A failure note on Session B after its recovery read', async () => {
    const remote = scriptRemote()
    const viewA = view({ question: 'Question for session A' })
    const viewB = view({ decisionId: 'decision-b' as DecisionId, sessionId: SESSION_B, question: 'Question for session B' })
    let releaseRecovery: ((views: readonly DecisionView[]) => void) | undefined
    let aCalls = 0
    remote.catalog.mockImplementation((sessionId: SessionId) => {
      if (sessionId === SESSION) {
        aCalls += 1
        if (aCalls === 1) return Promise.resolve({ ok: true, value: [viewA] })
        if (aCalls === 2) {
          // The catch path's recovery read hangs until the test releases it
          // the rejection tick's own re-read resolves normally.
          return new Promise<AnyOutcome>((resolve) => { releaseRecovery = (views) => { resolve({ ok: true, value: views }) } })
        }
        return Promise.resolve({ ok: true, value: [viewA] })
      }
      return Promise.resolve({ ok: true, value: [viewB] })
    })
    remote.submit.mockImplementationOnce(() => Promise.reject(new Error('submit failed')))
    const { props } = cardProps(remote)
    const { rerender } = render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    await screen.findByText(viewA.question)
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(releaseRecovery).toBeDefined() })
    rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
    expect(await screen.findByText(viewB.question)).toBeTruthy()
    // Session A's failed action completes its recovery read after the switch:
    // the failure note must never render under Session B.
    releaseRecovery?.([viewA])
    await waitFor(() => { expect(screen.queryByText(zh.actionFailed)).toBeNull() })
    expect(screen.queryByText(zh.rejected)).toBeNull()
    expect(screen.getByText(viewB.question)).toBeTruthy()
  })

  it('does not let a settled Session A submission release Session B\u2019s action lock', async () => {
    const remote = scriptRemote()
    const viewA = view({ question: 'Question for session A' })
    const viewB = view({ decisionId: 'decision-b' as DecisionId, sessionId: SESSION_B, question: 'Question for session B' })
    remote.catalog.mockImplementation((sessionId: SessionId) => Promise.resolve({
      ok: true,
      value: [sessionId === SESSION ? viewA : viewB],
    }))
    let releaseA: ((outcome: AnswerSubmitOutcome) => void) | undefined
    let releaseB: ((outcome: AnswerSubmitOutcome) => void) | undefined
    let submitCalls = 0
    remote.submit.mockImplementation(() => {
      submitCalls += 1
      if (submitCalls === 1) {
        return new Promise<AnyOutcome>((resolve) => { releaseA = (outcome) => { resolve({ ok: true, value: outcome }) } })
      }
      return new Promise<AnyOutcome>((resolve) => { releaseB = (outcome) => { resolve({ ok: true, value: outcome }) } })
    })
    const { props } = cardProps(remote)
    const { rerender } = render(<QuestionCard {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: zh.title }))
    await screen.findByText(viewA.question)
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(1) })
    rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
    expect(await screen.findByText(viewB.question)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Staging' }))
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledTimes(2) })
    // Session A's submission settles late with a rejection: it must not
    // release Session B's in-flight lock nor present its note under Session B.
    releaseA?.({ outcome: 'rejected', reason: 'DECISION_CONFLICT', message: 'late', requestId: REQUEST })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Staging' }).disabled).toBe(true)
    expect(screen.queryByText(zh.rejected)).toBeNull()
    // Session B's own submission settles and releases its own lock.
    releaseB?.({ outcome: 'submitting', requestId: REQUEST })
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Staging' }).disabled).toBe(false)
    })
  })

  it('presents a refused resume in the paused state the fresh read landed on', async () => {
    const paused = view({ suspended: true })
    const remote = scriptRemote({
      catalog: [[paused], [paused]],
      resume: [{ ok: false, reason: 'DECISION_CONFLICT', message: 'resume conflict' }],
    })
    await openPanel(remote)
    expect(await screen.findByText(zh.paused)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.resume }))
    await waitFor(() => { expect(remote.resume).toHaveBeenCalledWith(DECISION, 3) })
    expect(await screen.findByText(zh.actionFailed)).toBeTruthy()
    expect(screen.getByText(zh.paused)).toBeTruthy()
  })

  it('presents a refused dismiss for an unresolved in-flight answer', async () => {
    const remote = scriptRemote({
      catalog: [[view({ answerIndex: 'submitting' })]],
      dismiss: [{ ok: false, reason: 'DECISION_CONFLICT', message: 'refused' }],
    })
    await openPanel(remote)
    expect(await screen.findByText(zh.submitting)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.stopTracking }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmStop }))
    await waitFor(() => { expect(remote.dismiss).toHaveBeenCalledWith(DECISION, 3) })
    expect(await screen.findByText(zh.actionFailed)).toBeTruthy()
    expect(screen.getByText(zh.submitting)).toBeTruthy()
  })
})

describe('QuestionToolCard', () => {
  function toolProps(
    remote: SessionDecisionsRemote | undefined,
    meta: unknown,
    phase: 'preparing' | 'start' | 'result' = 'result',
  ): QuestionToolCardProps {
    const source = createQuestionSource(remote, { pollMs: 0 })
    return {
      phase,
      block: { meta } as never,
      source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh),
      t: makeTranslate(zh),
    } as QuestionToolCardProps
  }

  it('fetches the actual record from the persisted `{ decisionId, revision }` pointer', async () => {
    const remote = scriptRemote()
    const { container } = render(<QuestionToolCard {...toolProps(remote, { decisionId: DECISION, revision: 3 })} />)
    await waitFor(() => { expect(remote.get).toHaveBeenCalledWith(DECISION) })
    await waitFor(() => { expect(container.textContent).toContain(view().question) })
  })

  it('renders nothing before the result phase', () => {
    const { container } = render(<QuestionToolCard {...toolProps(scriptRemote(), undefined, 'preparing')} />)
    expect(container.children).toHaveLength(0)
  })

  it('shows the truthful invalid-copy state for an unparsable pointer or failed read', async () => {
    const unparsable = render(<QuestionToolCard {...toolProps(scriptRemote(), { decisionId: 7 })} />)
    await waitFor(() => { expect(unparsable.container.textContent).toContain(zh.toolMetaInvalid) })
    unparsable.unmount()
    const failed = render(<QuestionToolCard {...toolProps(scriptRemote({ failGet: true }), { decisionId: DECISION, revision: 3 })} />)
    await waitFor(() => { expect(failed.container.textContent).toContain(zh.toolMetaInvalid) })
    failed.unmount()
  })

  it('shows loading, never the invalid copy, when the same mounted instance reaches its result with a held fetch', async () => {
    const remote = scriptRemote()
    let release: ((record: DecisionView | undefined) => void) | undefined
    remote.get.mockImplementationOnce(() => new Promise<AnyOutcome>((resolve) => {
      release = (record) => { resolve({ ok: true, value: record }) }
    }))
    const source = createQuestionSource(remote, { pollMs: 0 })
    const propsFor = (phase: 'preparing' | 'result', meta: unknown): QuestionToolCardProps => ({
      phase,
      block: { meta } as never,
      source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh),
      t: makeTranslate(zh),
    } as QuestionToolCardProps)
    const { container, rerender } = render(<QuestionToolCard {...propsFor('preparing', undefined)} />)
    expect(container.children).toHaveLength(0)
    // The same instance transitions to its result with a valid pointer while
    // `get` is held: the loading line shows until the record arrives — never
    // the invalid copy, and never a fresh-mount shortcut.
    rerender(<QuestionToolCard {...propsFor('result', { decisionId: DECISION, revision: 3 })} />)
    expect(remote.get).toHaveBeenCalledWith(DECISION)
    expect(container.textContent).toContain(zh.loading)
    expect(container.textContent).not.toContain(zh.toolMetaInvalid)
    release?.(view())
    await waitFor(() => { expect(container.textContent).toContain(view().question) })
    expect(container.textContent).not.toContain(zh.toolMetaInvalid)
  })
})

describe('QuestionComposerCard', () => {
  it('discovers a newly saved question when its producing turn stops without waiting for the background poll', async () => {
    const remote = scriptRemote({ catalog: [[], [view()]] })
    const { props, source } = cardProps(remote)
    let running = true
    const useSession: QuestionCardProps['useSession'] = select => sessionHook(running)(select)
    const { rerender } = render(<QuestionComposerCard {...props} useSession={useSession} />)
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalledTimes(1) })
    expect(screen.queryByRole('button', { name: 'Staging' })).toBeNull()
    running = false
    rerender(<QuestionComposerCard {...props} useSession={useSession} />)
    expect(await screen.findByRole('button', { name: 'Staging' }, { timeout: 1000 })).toBeTruthy()
    expect(remote.catalog).toHaveBeenCalledTimes(2)
    source.dispose()
  })

  it('shows answer controls without any header click and sends the saved question identity', async () => {
    const remote = scriptRemote()
    const { props } = cardProps(remote)
    render(<QuestionComposerCard {...props} />)
    const choice = await screen.findByRole('button', { name: 'Staging' })
    expect(screen.queryByRole('button', { name: zh.title })).toBeNull()
    fireEvent.click(choice)
    await waitFor(() => { expect(remote.submit).toHaveBeenCalledWith(DECISION, 3, REQUEST, { choiceOrdinal: 1 }) })
  })

  it('keeps its inline draft across a source refresh', async () => {
    const { props, source } = cardProps(scriptRemote())
    render(<QuestionComposerCard {...props} />)
    const input = await screen.findByPlaceholderText<HTMLTextAreaElement>(zh.answerPlaceholder)
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    act(() => { source.refresh() })
    await waitFor(() => { expect(screen.getByPlaceholderText<HTMLTextAreaElement>(zh.answerPlaceholder).value).toBe('Keep this draft') })
    expect(screen.getByPlaceholderText(zh.answerPlaceholder)).toBe(input)
  })

  it('leaves the ordinary composer unobstructed when no question is pending', async () => {
    const remote = scriptRemote({ catalog: [[]] })
    const { props } = cardProps(remote)
    const { container } = render(<QuestionComposerCard {...props} />)
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalled() })
    expect(container.children).toHaveLength(0)
  })
})

describe('SessionQuestionMark', () => {
  function markProps(remote: SessionDecisionsRemote | undefined): SessionQuestionMarkProps {
    const source = createQuestionSource(remote, { pollMs: 0 })
    return {
      sessionId: SESSION,
      source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh),
      t: makeTranslate(zh),
    } as SessionQuestionMarkProps
  }

  it('shows the mark while the Session has an open question and nothing otherwise', async () => {
    const remote = scriptRemote()
    const shown = render(<SessionQuestionMark {...markProps(remote)} />)
    await waitFor(() => { expect(shown.container.querySelector('[data-session-question-mark]')).not.toBeNull() })
    shown.unmount()
    const empty = scriptRemote({ catalog: [[]] })
    const hidden = render(<SessionQuestionMark {...markProps(empty)} />)
    await waitFor(() => { expect(empty.catalog).toHaveBeenCalled() })
    expect(hidden.container.querySelector('[data-session-question-mark]')).toBeNull()
  })

  it('degrades to no mark when the namespace is unmounted', async () => {
    const { container } = render(<SessionQuestionMark {...markProps(undefined)} />)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(container.querySelector('[data-session-question-mark]')).toBeNull()
  })
})

describe('question source over the real namespace face', () => {
  it('caches the catalog for one tick, invalidates it after a mutation, and reads fresh on demand', async () => {
    const remote = scriptRemote()
    const source = createQuestionSource(remote, { pollMs: 0 })
    await source.catalog(SESSION)
    await source.catalog(SESSION)
    expect(remote.catalog).toHaveBeenCalledTimes(1)
    // A post-action read must resolve the Host state after the mutation.
    await source.catalog(SESSION, { fresh: true })
    expect(remote.catalog).toHaveBeenCalledTimes(2)
    await source.dismiss(view())
    await source.catalog(SESSION)
    expect(remote.catalog).toHaveBeenCalledTimes(3)
    await source.catalog(SESSION)
    expect(remote.catalog).toHaveBeenCalledTimes(3)
    source.dispose()
  })

  it('closes tracking through dismiss and an unreserved question through cancel with the saved identity', async () => {
    const remote = scriptRemote()
    const source = createQuestionSource(remote, { pollMs: 0 })
    const outcome = await source.dismiss(view())
    expect(remote.dismiss).toHaveBeenCalledWith(DECISION, 3)
    expect(outcome.ok).toBe(true)
    const cancelled = await source.cancel(view())
    expect(remote.cancel).toHaveBeenCalledWith(DECISION, 3)
    expect(cancelled.ok).toBe(true)
    source.dispose()
  })

  it('bumps the tick on the poll interval and stops with dispose', async () => {
    vi.useFakeTimers()
    try {
      const source = createQuestionSource(scriptRemote(), { pollMs: 1000 })
      const ticks: number[] = []
      // The snapshot source's listener carries no value; read the tick from
      // the source so the recorded values stay real tick numbers.
      source.hooks.refresh.subscribe(() => { ticks.push(source.hooks.refresh.getSnapshot()) })
      await vi.advanceTimersByTimeAsync(2500)
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      source.dispose()
      const at = ticks.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(ticks.length).toBe(at)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('locale dictionaries', () => {
  it('keep key parity across zh and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('question source availability and refresh lifecycle', () => {
  it('rejects every operation when the feature namespace is absent', async () => {
    const source = createQuestionSource(undefined, { pollMs: 0 })
    for (const call of [() => source.catalog(SESSION), () => source.get(DECISION), () => source.submit(view(), { text: 'hello' }),
      () => source.cancel(view()), () => source.dismiss(view()), () => source.pause(view(), 'user-requested'), () => source.resume(view())]) {
      await expect(call()).rejects.toThrow('not mounted')
    }
    source.dispose()
  })

  it('invalidates cached catalogs on the default timer and disposes idempotently', async () => {
    vi.useFakeTimers()
    const remote = scriptRemote()
    const source = createQuestionSource(remote)
    try {
      await source.catalog(SESSION)
      await source.catalog(SESSION)
      expect(remote.catalog).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(15_000)
      await source.catalog(SESSION)
      expect(remote.catalog).toHaveBeenCalledTimes(2)
      source.dispose()
      source.dispose()
      vi.advanceTimersByTime(30_000)
      await source.catalog(SESSION)
      expect(remote.catalog).toHaveBeenCalledTimes(2)
    } finally { source.dispose(); vi.useRealTimers() }
  })

  it('does not let a stale failed read evict the newer catalog request', async () => {
    const old = Promise.withResolvers<AnyOutcome>()
    const remote = scriptRemote()
    remote.catalog.mockImplementationOnce(() => old.promise)
    const source = createQuestionSource(remote, { pollMs: 0 })
    const first = source.catalog(SESSION)
    const refusal = expect(first).rejects.toThrow('old request failed')
    const fresh = source.catalog(SESSION, { fresh: true })
    await fresh
    old.reject(new Error('old request failed'))
    await refusal
    await source.catalog(SESSION)
    expect(remote.catalog).toHaveBeenCalledTimes(2)
  })
})

describe('late card reads', () => {
  it.each([null, 'pointer', {}, { decisionId: '' }, { decisionId: DECISION }, { decisionId: DECISION, revision: 1.5 }])('reports invalid persisted tool metadata: %j', async (meta) => {
    const source = createQuestionSource(scriptRemote(), { pollMs: 0 })
    const props = { phase: 'result', block: { meta }, source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh), t: makeTranslate(zh) } as QuestionToolCardProps
    render(<QuestionToolCard {...props} />)
    expect(await screen.findByText(zh.toolMetaInvalid)).toBeTruthy()
  })

  it.each([true, false])('ignores a tool read settled after unmount, rejected=%s', async (rejected) => {
    const pending = Promise.withResolvers<AnyOutcome>()
    const remote = scriptRemote()
    remote.get.mockImplementationOnce(() => pending.promise)
    const source = createQuestionSource(remote, { pollMs: 0 })
    const props = { phase: 'result', block: { meta: { decisionId: DECISION, revision: 3 } }, source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh), t: makeTranslate(zh) } as QuestionToolCardProps
    const mounted = render(<QuestionToolCard {...props} />)
    await waitFor(() => { expect(remote.get).toHaveBeenCalled() })
    mounted.unmount()
    if (rejected) pending.reject(new Error('offline'))
    else pending.resolve({ ok: true, value: view() })
    await pending.promise.catch(() => undefined)
    expect(screen.queryByText(view().question)).toBeNull()
  })

  it.each([true, false])('ignores a sidebar read settled after unmount, rejected=%s', async (rejected) => {
    const pending = Promise.withResolvers<AnyOutcome>()
    const remote = scriptRemote()
    remote.catalog.mockImplementationOnce(() => pending.promise)
    const source = createQuestionSource(remote, { pollMs: 0 })
    const props = { sessionId: SESSION, source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh), t: makeTranslate(zh) } as SessionQuestionMarkProps
    const mounted = render(<SessionQuestionMark {...props} />)
    await waitFor(() => { expect(remote.catalog).toHaveBeenCalled() })
    mounted.unmount()
    if (rejected) pending.reject(new Error('offline'))
    else pending.resolve({ ok: true, value: [view()] })
    await pending.promise.catch(() => undefined)
    expect(screen.queryByText(zh.markAria)).toBeNull()
  })

  it('keeps clicking the question mark from activating its Session row', async () => {
    const source = createQuestionSource(scriptRemote(), { pollMs: 0 })
    const activate = vi.fn()
    const props = { sessionId: SESSION, source,
      useRefresh: bindSnapshotSelector(source.hooks.refresh), t: makeTranslate(zh) } as SessionQuestionMarkProps
    render(<div onClick={activate}><SessionQuestionMark {...props} /></div>)
    fireEvent.click(await screen.findByText(zh.markAria))
    expect(activate).not.toHaveBeenCalled()
  })
})

describe('Host state projection', () => {
  it.each([
    [{ resolutionKind: 'dismissed' }, 'dismissed'], [{ answerIndex: 'dismissed' }, 'dismissed'],
    [{ lifecycle: 'expired' }, 'expired'], [{ lifecycle: 'cancelled' }, 'cancelled'],
    [{ lifecycle: 'superseded' }, 'superseded'], [{ lifecycle: 'answered' }, 'admitted'],
    [{ answerIndex: 'submitting' }, 'submitting'], [{ answerIndex: 'admitted' }, 'admitted'],
    [{ answerIndex: 'needs_reconciliation' }, 'needs_reconciliation'], [{ answerIndex: 'withdrawn' }, 'withdrawn'],
    [{ suspended: true }, 'paused'], [{ expiresAtUtc: '2000-01-01T00:00:00Z' }, 'expired'], [{}, 'active'],
  ] satisfies [Partial<DecisionView>, string][])('shows %j as %s', (state, expected) => {
    expect(deriveStatus(view(state), Date.now())).toBe(expected)
  })

  it.each([
    ['none', 'cancel'], ['submitting', 'dismiss'], ['needs_reconciliation', 'dismiss'],
    ['withdrawn', 'dismiss'], ['admitted', undefined], ['dismissed', undefined],
  ] satisfies [DecisionView['answerIndex'], string | undefined][])('offers the Host close action for %s', (answerIndex, expected) => {
    expect(closeActionFor(view({ answerIndex }))).toBe(expected)
  })

  it('selects the latest open record regardless of input ordering', () => {
    const older = view({ createdAtUtc: '2026-01-01T00:00:00Z' })
    const newer = view({ createdAtUtc: '2026-02-01T00:00:00Z' })
    const closed = view({ lifecycle: 'cancelled', createdAtUtc: '2026-03-01T00:00:00Z' })
    expect(pickOpenQuestion([closed, older, newer])).toBe(newer)
    expect(pickOpenQuestion([newer, older, closed])).toBe(newer)
    expect(pickOpenQuestion([closed])).toBeUndefined()
  })
})


it('shows an unavailable tool pointer when its saved question was removed', async () => {
  const source = createQuestionSource(scriptRemote({ get: [undefined] }), { pollMs: 0 })
  const props = { phase: 'result', block: { meta: { decisionId: DECISION, revision: 3 } }, source,
    useRefresh: bindSnapshotSelector(source.hooks.refresh), t: makeTranslate(zh) } as QuestionToolCardProps
  render(<QuestionToolCard {...props} />)
  expect(await screen.findByText(zh.toolMetaInvalid)).toBeTruthy()
})


it.each(['submit', 'pause'] as const)('admits one %s action within the same browser dispatch batch', async (action) => {
  const remote = scriptRemote()
  const pending = Promise.withResolvers<AnyOutcome>()
  if (action === 'submit') remote.submit.mockImplementation(() => pending.promise)
  else remote.pause.mockImplementation(() => pending.promise)
  await openPanel(remote)
  const button = screen.getByRole('button', { name: action === 'submit' ? 'Staging' : zh.pause })
  try {
    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(action === 'submit' ? remote.submit : remote.pause).toHaveBeenCalledTimes(1)
  } finally {
    pending.resolve({ ok: true, value: action === 'submit'
      ? { outcome: 'submitting', requestId: REQUEST } : { ok: true, record: view({ suspended: true }) } })
    await act(async () => { await pending.promise })
  }
})

it('keeps the open question panel visible while retrying a failed catalog read', async () => {
  const remote = scriptRemote()
  const pending = Promise.withResolvers<AnyOutcome>()
  remote.catalog.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(() => pending.promise)
  const { props } = cardProps(remote)
  render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  expect(await screen.findByText(zh.loadFailed)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.retry }))
  try {
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(zh.loading)).toBeTruthy()
  } finally {
    pending.resolve({ ok: true, value: [view()] })
    await act(async () => { await pending.promise })
  }
})

it('retains the raw expiry text from an invalid Remote timestamp', async () => {
  await openPanel(scriptRemote({ catalog: [[view({ expiresAtUtc: 'unreadable timestamp' })]] }))
  expect(screen.getByText(/unreadable timestamp/)).toBeTruthy()
})

it('updates an open card when its expiry clock advances and ignores unrelated key presses', async () => {
  vi.useFakeTimers()
  try {
    const remote = scriptRemote({ catalog: [[view({ expiresAtUtc: new Date(Date.now() + 500).toISOString() })]] })
    const { props } = cardProps(remote)
    render(<QuestionCard {...props} />)
    await act(async () => { await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: zh.title }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('button', { name: 'Staging' })).toBeNull()
  } finally { cleanup(); vi.useRealTimers() }
})

it('ignores a rejected catalog read after switching to a different Session', async () => {
  const pending = Promise.withResolvers<AnyOutcome>()
  const remote = scriptRemote()
  const b = view({ sessionId: SESSION_B, question: 'Question B' })
  remote.catalog.mockImplementation(session => session === SESSION ? pending.promise : Promise.resolve({ ok: true, value: [b] }))
  const { props } = cardProps(remote)
  const { rerender } = render(<QuestionCard {...props} />)
  rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  expect(await screen.findByText(b.question)).toBeTruthy()
  pending.reject(new Error('old Session offline'))
  await act(async () => { await pending.promise.catch(() => undefined) })
  expect(screen.getByText(b.question)).toBeTruthy()
  expect(screen.queryByText(zh.loadFailed)).toBeNull()
})

it.each(['submit', 'pause'] as const)('ignores a late rejected %s after switching Sessions', async (action) => {
  const remote = scriptRemote()
  const pending = Promise.withResolvers<AnyOutcome>()
  const b = view({ sessionId: SESSION_B, question: 'Question B' })
  remote.catalog.mockImplementation(session => Promise.resolve({ ok: true, value: [session === SESSION ? view() : b] }))
  if (action === 'submit') remote.submit.mockImplementationOnce(() => pending.promise)
  else remote.pause.mockImplementationOnce(() => pending.promise)
  const { props } = cardProps(remote)
  const { rerender } = render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  fireEvent.click(screen.getByRole('button', { name: action === 'submit' ? 'Staging' : zh.pause }))
  rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
  expect(await screen.findByText(b.question)).toBeTruthy()
  pending.reject(new Error('old action failed'))
  await act(async () => { await pending.promise.catch(() => undefined) })
  expect(screen.getByText(b.question)).toBeTruthy()
  expect(screen.queryByText(zh.actionFailed)).toBeNull()
})

it('shows a failed mutation after re-reading the actual current question', async () => {
  const remote = scriptRemote()
  remote.pause.mockRejectedValueOnce(new Error('offline'))
  await openPanel(remote)
  fireEvent.click(screen.getByRole('button', { name: zh.pause }))
  expect(await screen.findByText(zh.actionFailed)).toBeTruthy()
  expect(screen.getByText(view().question)).toBeTruthy()
})

it.each(['submit', 'pause'] as const)('ignores a late %s refresh after switching Sessions', async (action) => {
  const remote = scriptRemote()
  const pendingRead = Promise.withResolvers<AnyOutcome>()
  const b = view({ sessionId: SESSION_B, question: 'Question B' })
  let holdA = false
  remote.catalog.mockImplementation(session => session === SESSION && holdA ? pendingRead.promise
    : Promise.resolve({ ok: true, value: [session === SESSION ? view() : b] }))
  const { props } = cardProps(remote)
  const { rerender } = render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  holdA = true
  fireEvent.click(screen.getByRole('button', { name: action === 'submit' ? 'Staging' : zh.pause }))
  await waitFor(() => { expect(remote.catalog.mock.calls.filter(([session]) => session === SESSION).length).toBeGreaterThan(1) })
  rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
  expect(await screen.findByText(b.question)).toBeTruthy()
  pendingRead.resolve({ ok: true, value: [view()] })
  await act(async () => { await pendingRead.promise })
  expect(screen.getByText(b.question)).toBeTruthy()
})

it.each(['submit', 'pause'] as const)('ignores a late %s error recovery read after switching Sessions', async (action) => {
  const remote = scriptRemote()
  const pendingRead = Promise.withResolvers<AnyOutcome>()
  const b = view({ sessionId: SESSION_B, question: 'Question B' })
  let holdA = false
  remote.catalog.mockImplementation(session => session === SESSION && holdA ? pendingRead.promise
    : Promise.resolve({ ok: true, value: [session === SESSION ? view() : b] }))
  remote[action].mockRejectedValueOnce(new Error('action failed'))
  const { props } = cardProps(remote)
  const { rerender } = render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  holdA = true
  fireEvent.click(screen.getByRole('button', { name: action === 'submit' ? 'Staging' : zh.pause }))
  await waitFor(() => { expect(remote.catalog.mock.calls.filter(([session]) => session === SESSION).length).toBeGreaterThan(1) })
  rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
  expect(await screen.findByText(b.question)).toBeTruthy()
  pendingRead.resolve({ ok: true, value: [view()] })
  await act(async () => { await pendingRead.promise })
  expect(screen.getByText(b.question)).toBeTruthy()
  expect(screen.queryByText(zh.actionFailed)).toBeNull()
})

it('ignores a successful pause response that arrives after switching Sessions', async () => {
  const remote = scriptRemote()
  const pending = Promise.withResolvers<AnyOutcome>()
  remote.pause.mockImplementationOnce(() => pending.promise)
  const b = view({ sessionId: SESSION_B, question: 'Question B' })
  remote.catalog.mockImplementation(session => Promise.resolve({ ok: true, value: [session === SESSION ? view() : b] }))
  const { props } = cardProps(remote)
  const { rerender } = render(<QuestionCard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: zh.title }))
  fireEvent.click(screen.getByRole('button', { name: zh.pause }))
  rerender(<QuestionCard {...props} sessionId={SESSION_B} />)
  expect(await screen.findByText(b.question)).toBeTruthy()
  pending.resolve({ ok: true, value: { ok: true, record: view({ suspended: true }) } })
  await act(async () => { await pending.promise })
  expect(screen.getByText(b.question)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Staging' })).toBeTruthy()
})
