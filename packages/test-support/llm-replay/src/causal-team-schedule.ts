import { symbols } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionScript } from './index.ts'

/**
 * Test-only causal schedule for the recorded three-session `team-orchestration`
 * fixture (Lead + notes-writer + summary-writer). Strict keyless replay is
 * deterministic in adapter order but not in concurrent-team ordering: the
 * recorded journal interleaves the three sessions' turns at points a live run
 * reaches only through real causality (a claim append before another member's
 * list call, a settlement splice before the Lead's next call). This driver
 * recreates exactly those causal edges on top of the replayed fixture:
 *
 * - it holds specific teammate tool executions (`tools/pre-execute`) until the
 *   recorded predecessor append has landed,
 * - it releases the real `waitForChange` promise of each recorded wait only
 *   after the waiter is registered and the recorded wake append is about to
 *   commit, and
 * - it parks exactly one late notification flush (the task-2 claim) so its
 *   `onCommit` notify fires inside the Lead's step-8 wait instead of before it.
 *
 * Everything else stays real: recorded chunks stream unchanged, tools execute
 * for real after their gate, journals/persistence/waiters run unmodified. The
 * driver never fakes a result and never resets a recorded timeout.
 */

/** Error-message prefix for every driver failure. */
const TAG = 'llm-replay causal-team-schedule'

/**
 * Bounded diagnostic for a schedule step that never settles. Must stay well
 * below the fixture's recorded wait timeouts (lead 180s, summary 60s) so a
 * broken schedule fails with a crisp driver error instead of letting a real
 * waiter time out and rewrite the recorded output.
 */
const SCHEDULE_WATCHDOG_MS = 30_000

/** Recorded model-call counts: Lead, notes-writer, summary-writer. */
const EXPECTED_CALLS = [16, 8, 13] as const

/** The two recorded teammate names; any other Team member fails loud. */
const NOTES_WRITER = 'notes-writer'
const SUMMARY_WRITER = 'summary-writer'

/**
 * Tool holds by member and tool name, one entry per recorded occurrence
 * (0-based). `'pass'` marks a recorded occurrence with no timing constraint;
 * a teammate tool call in this table is parked until the gate named at its
 * occurrence opens, and occurrences beyond the table fail loud.
 */
const MEMBER_TOOL_HOLDS: Record<string, Record<string, (HoldName | 'pass')[]>> = {
  [NOTES_WRITER]: {
    team_task_update: ['notes-claim', 'notes-complete'],
    send_message: ['notes-mail'],
  },
  [SUMMARY_WRITER]: {
    team_task_list: ['summary-first-list', 'pass'],
    team_task_update: ['summary-claim', 'summary-complete'],
    send_message: ['summary-mail'],
  },
}

/** Allocate each named hold once for one replay driver. */
function createHolds() {
  return {
    'notes-claim': deferred<void>(),
    'notes-complete': deferred<void>(),
    'notes-mail': deferred<void>(),
    'notes-final-stream': deferred<void>(),
    'summary-first-list': deferred<void>(),
    'summary-claim': deferred<void>(),
    'summary-complete': deferred<void>(),
    'summary-mail': deferred<void>(),
    'summary-final-stream': deferred<void>(),
  }
}

/** One gated tool execution awaiting its recorded predecessor. */
type HoldName = keyof ReturnType<typeof createHolds>

/** Structural view of one live Team membership. */
export interface TeamMembershipView {
  readonly role: 'lead' | 'teammate'
  readonly name: string
}

/**
 * Structural view of the live Team service the driver gates. The real
 * `agentTeams` service satisfies it; declaring it locally keeps the
 * test-support package free of a runtime dependency on the experimental
 * package. Caller and membership parameters use the public `Agent` type
 * because the live service demands the exact live Agent as its authority
 * credential — an id-only stand-in would claim a wider contract than the
 * real port accepts.
 */
export interface TeamScheduleSeam {
  waitForChange: (caller: Agent, timeoutMs: number, signal: AbortSignal) => Promise<{ timedOut: boolean }>
  tryMembership: (agent: Agent) => TeamMembershipView | undefined
}

/** Structural view of the session store whose `flush` the driver wraps. */
export interface FlushSeam {
  flush: (session: Session) => Promise<boolean>
}

/**
 * The seams the driver needs from the host Context, injected instead of taken
 * directly so unit tests can drive the schedule with fakes.
 */
export interface ScheduleHost {
  /** Resolve the live Team service, or `undefined` when the scenario has none. */
  teamService(): TeamScheduleSeam | undefined
  /** The session store whose `flush` implementation is wrapped for the park. */
  sessionStore(): FlushSeam
  /** Register the lead-session append observer; returns its disposer. */
  onSessionEvent(listener: (session: Session, event: SessionEvent) => void): () => void
  /** Register the teammate tool gate; returns its disposer. */
  onPreExecute(
    listener: (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>,
  ): () => void
}

/** Constructor inputs: the host seams plus the replay binding facts. */
export interface CausalScheduleDeps {
  host: ScheduleHost
  /** The loaded replay scripts; validated against the recorded team schedule. */
  scripts: readonly SessionScript[]
  /**
   * Live-session ids by script index, filled in as scripts bind. Read lazily
   * so settlement matchers see child bindings that happen after install.
   */
  liveSessionIds: readonly (string | undefined)[]
  /** Watchdog bound for schedule steps; defaults to {@link SCHEDULE_WATCHDOG_MS}. Unit tests shorten it. */
  watchdogMs?: number
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Unawaited deferreds (a settle nobody consumes, a gate disposed early) must
  // not crash the process; real consumers still observe the rejection.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/** Reject with the signal's abort reason when the signal fires. */
function abortOf(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
  if (signal === undefined) {
    const pending = deferred<never>()
    return { promise: pending.promise, dispose: () => {} }
  }
  const aborted = deferred<never>()
  if (signal.aborted) {
    aborted.reject(signal.reason)
    return { promise: aborted.promise, dispose: () => {} }
  }
  const onAbort = (): void => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', onAbort, { once: true })
  return {
    promise: aborted.promise,
    dispose: () => { signal.removeEventListener('abort', onAbort) },
  }
}

/**
 * Return the raw service instance behind a Cordis traceable proxy. Reading a
 * method property through the proxy mints a fresh shadow wrapper, so a method
 * replacement and its identity-based restore must run on the instance behind
 * `symbols.original` (the established `Reflect.get(receiver, symbols.original)`
 * receiver pattern). Plain test doubles pass through unchanged.
 */
function originalOf<T extends object>(receiver: T): T {
  const original: unknown = Reflect.get(receiver, symbols.original)
  // Runtime-validated unwrap: the proxy's `symbols.original` is the raw
  // instance, so the single downcast is justified by the typeof guard.
  return typeof original === 'object' && original !== null ? original as T : receiver
}

/** One observed lead-session append: the event plus its flush-settle promise. */
interface WaitedAppend {
  readonly event: SessionEvent
  /** Resolves when the append's journal flush (and any park) completes. */
  readonly settle: Deferred<void>
}

interface AppendWaiter {
  match(event: SessionEvent): boolean
  done: Deferred<WaitedAppend>
}

/**
 * Validate the loaded scripts against the recorded team schedule. Fails loud
 * before any gating so a wrong fixture produces a crisp error instead of a
 * schedule that deadlocks mid-run.
 */
function validateFixture(scripts: readonly SessionScript[]): void {
  if (scripts.length !== EXPECTED_CALLS.length) {
    throw new Error(
      `${TAG}: the fixture recorded ${scripts.length} session(s) but the causal team schedule `
      + `requires exactly ${EXPECTED_CALLS.length} (Lead + two teammates) — the flag is specific `
      + 'to the recorded team-orchestration fixture',
    )
  }
  for (const [index, script] of scripts.entries()) {
    const expected = EXPECTED_CALLS[index]
    if (expected !== undefined && script.entries.length !== expected) {
      throw new Error(
        `${TAG}: script #${index} (${script.recordedId}) recorded ${script.entries.length} model call(s) `
        + `but the causal team schedule requires ${expected} — re-check the fixture or drop the flag`,
      )
    }
    for (const [call, entry] of script.entries.entries()) {
      if (entry.kind !== 'chunks') {
        throw new Error(
          `${TAG}: script #${index} call #${call + 1} is a ${entry.kind} entry — the causal team `
          + 'schedule only supports the all-chunks recorded fixture',
        )
      }
    }
  }
}

/**
 * Install and drive the recorded causal schedule. Created by
 * {@link installLlmReplay} when `causalTeamSchedule` is enabled; gates model
 * calls through `beforeModelCall` and disposes with the replay handle.
 */
export class CausalTeamScheduleDriver {
  private readonly deps: CausalScheduleDeps
  private readonly watchdogMs: number
  private readonly holds = createHolds()
  private readonly holdCounts = new Map<string, number>()
  private readonly appendWaiters: AppendWaiter[] = []
  private readonly settlementWaiters: Array<{ senderSessionId: string; done: Deferred<void> }> = []
  private readonly settles = new Map<string, Deferred<void>[]>()
  private readonly disposers: (() => void)[] = []
  private readonly restores: (() => void)[] = []

  /** Rejects on dispose so every bounded await unwinds instead of hanging. */
  private readonly disposeGate = deferred<never>()
  private disposed = false
  private installed = false
  private leadSessionId: string | undefined
  private teams: TeamScheduleSeam | undefined
  /** Set while the call-8 window is open: team/task appends arm the flush park. */
  private phase: 'idle' | 'call8' = 'idle'
  private parkArmed = false
  private stepEightGate: Deferred<void> | undefined
  private stepEightWatchdog: ReturnType<typeof setTimeout> | undefined
  /** Set while the call-6 gate waits for the summary-writer to enter waitForChange. */
  private summaryArmed: Deferred<void> | undefined
  private leadWaitIndex = 0

  constructor(deps: CausalScheduleDeps) {
    validateFixture(deps.scripts)
    this.deps = deps
    this.watchdogMs = deps.watchdogMs ?? SCHEDULE_WATCHDOG_MS
    this.disposeGate.promise.catch(() => {})
  }

  /**
   * Gate one replayed model call. Called inside the replay generator before
   * the recorded chunks stream; returns once the recorded causal predecessors
   * of this call have landed (or immediately for ungated calls).
   * @param scriptIndex - bound script index (0 = Lead).
   * @param callIndex - 0-based model-call index within the script.
   * @param options - the live generate options (session id and abort signal).
   */
  async beforeModelCall(scriptIndex: number, callIndex: number, options: GenerateOptions): Promise<void> {
    if (this.disposed) throw new Error(`${TAG}: driver disposed before the schedule completed`)
    if (scriptIndex === 0) {
      if (callIndex === 0) {
        if (options.sessionId === undefined) {
          throw new Error(`${TAG}: the first model call carries no session id — the Team Lead session must run with a stable session id`)
        }
        this.install(options.sessionId)
      }
      if (this.leadSessionId === undefined || options.sessionId !== this.leadSessionId) {
        throw new Error(`${TAG}: a different session requested the Lead script — the recorded team fixture binds one Lead session`)
      }
      switch (callIndex) {
        case 5: {
          await this.leadCall6Gate(options.signal)
          return
        }
        case 7: {
          await this.leadCall8Gate(options.signal)
          return
        }
        case 8: {
          await this.leadCall9Gate(options.signal)
          return
        }
        case 11: {
          await this.leadCall12Gate(options.signal)
          return
        }
        case 12: {
          await this.leadCall13Gate(options.signal)
          return
        }
        default: return
      }
    }
    const script = this.deps.scripts[scriptIndex]
    if (script === undefined) throw new Error(`${TAG}: unknown script index ${scriptIndex}`)
    if (callIndex !== script.entries.length - 1) return
    const holdName = scriptIndex === 1 ? 'notes-final-stream' : 'summary-final-stream'
    await this.bounded(this.hold(holdName).promise, options.signal, `closing stream hold ${holdName}`)
  }

  /**
   * Remove every wrapper and listener (only while still owned), reject all
   * pending gates with a crisp error, and clear watchdogs. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) dispose()
    for (const restore of this.restores.splice(0)) restore()
    clearTimeout(this.stepEightWatchdog)
    this.stepEightWatchdog = undefined
    const parkedGate = this.stepEightGate
    this.stepEightGate = undefined
    this.summaryArmed = undefined
    const failure = new Error(`${TAG}: driver disposed before the schedule completed`)
    // The parked flush path awaits this gate outside `bounded`, so dropping the
    // reference without rejecting it would leak the flush promise forever.
    parkedGate?.reject(failure)
    this.disposeGate.reject(failure)
    for (const hold of Object.values(this.holds)) hold.reject(failure)
    for (const waiter of this.appendWaiters.splice(0)) waiter.done.reject(failure)
    for (const waiter of this.settlementWaiters.splice(0)) waiter.done.reject(failure)
    for (const queue of this.settles.values()) {
      for (const settle of queue.splice(0)) settle.reject(failure)
    }
    this.settles.clear()
    this.parkArmed = false
    this.phase = 'idle'
  }

  // --- install ---

  private install(leadSessionId: string): void {
    const teams = this.deps.host.teamService()
    if (teams === undefined) {
      throw new Error(`${TAG}: the scenario has no agentTeams service — the flag requires the recorded team-orchestration composition`)
    }
    this.leadSessionId = leadSessionId
    this.teams = teams
    this.wrapWaitForChange(teams)
    this.wrapFlush(this.deps.host.sessionStore())
    this.disposers.push(this.deps.host.onSessionEvent(this.onSessionEvent))
    this.disposers.push(this.deps.host.onPreExecute(this.onPreExecute))
    this.installed = true
  }

  /**
   * Wrap `waitForChange` so each recorded wait calls the original exactly once
   * (registering the real waiter and arming the real timeout) and only then
   * performs the recorded release. The real pending promise is returned
   * untouched — the driver never fakes a wait result. The wrap and its restore
   * run on the raw service instance behind the Cordis traceable proxy.
   */
  private wrapWaitForChange(teams: TeamScheduleSeam): void {
    const raw = originalOf(teams)
    this.overrideMethod(raw, 'waitForChange', (original, owner) => {
      return async (caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<{ timedOut: boolean }> => {
        const pending = original.call(owner, caller, timeoutMs, signal)
        // The release path observes `pending`; this guard covers the abandoned
        // branch when the release itself fails (e.g. a later real timeout).
        pending.catch(() => {})
        await this.releaseFor(caller, signal)
        return await pending
      }
    })
  }

  /**
   * Replace one service method on the raw Cordis instance: capture the prior
   * own descriptor, install the wrapped value, and register a restore that
   * re-installs that descriptor — or deletes the own property when the method
   * previously lived on the prototype — only while the own property is still
   * this driver's wrapper. A later owner's replacement is therefore preserved,
   * and identity comparisons see the raw function, never a proxy shadow.
   */
  private overrideMethod<O extends object, N extends keyof O & string>(
    owner: O,
    name: N,
    wrap: (original: O[N], owner: O) => O[N],
  ): void {
    const original = owner[name]
    const prior = Object.getOwnPropertyDescriptor(owner, name)
    if (prior !== undefined && typeof prior.value !== 'function') {
      throw new Error(`${TAG}: ${name} is not a replaceable service method`)
    }
    const wrapped = wrap(original, owner)
    owner[name] = wrapped
    this.restores.push(() => {
      if (Object.getOwnPropertyDescriptor(owner, name)?.value !== wrapped) return
      if (prior === undefined) Reflect.deleteProperty(owner, name)
      else Object.defineProperty(owner, name, prior)
    })
  }

  /**
   * Wrap the session store's `flush` for the one-shot late-notification park.
   * A parked invocation runs the real flush first, then awaits the call-8 arm
   * gate, then returns — so the journal's `onCommit` notify fires inside the
   * Lead's step-8 wait instead of before it. Settle deferreds (flush-completion
   * witnesses for gated appends) resolve after the same completion point. The
   * wrap and its restore run on the raw store instance behind the Cordis
   * traceable proxy.
   */
  private wrapFlush(store: FlushSeam): void {
    const raw = originalOf(store)
    this.overrideMethod(raw, 'flush', (original, owner) => {
      return (session: Session): Promise<boolean> => {
        const settle = this.shiftSettle(session.id)
        const consumePark = session.id === this.leadSessionId && this.parkArmed
        if (consumePark) {
          this.parkArmed = false
          this.stepEightGate = this.armStepEightGate()
        }
        const gate = consumePark ? this.stepEightGate : undefined
        const result = original.call(owner, session)
        return (async () => {
          const completed = await result
          if (gate !== undefined) await gate.promise
          settle?.resolve()
          return completed
        })()
      }
    })
  }

  // --- model-call gates ---

  /**
   * Lead call 6 (step 6): the notes task-1 claim must commit (append + full
   * flush settle) before the summary-writer's first `team_task_list` runs, and
   * the summary-writer must already be inside `waitForChange` before the Lead
   * streams this call.
   */
  private async leadCall6Gate(signal: AbortSignal | undefined): Promise<void> {
    const claim = this.expectAppend(event => this.isTaskStatus(event, 'in_progress'))
    this.openHold('notes-claim')
    await this.consumeWaited(claim, signal, 'notes task-1 claim (team/task in_progress)')
    this.summaryArmed = deferred()
    this.openHold('summary-first-list')
    await this.bounded(this.summaryArmed.promise, signal, 'summary-writer wait_agent entry')
  }

  /**
   * Lead call 8 (step 8): the notes mail must be delivered (queued append, real
   * steer splice, delivered append) and the summary task-2 claim appended before
   * the Lead streams this call. Only the claim's flush parks — see the park
   * arming rule on the append observer.
   */
  private async leadCall8Gate(signal: AbortSignal | undefined): Promise<void> {
    this.phase = 'call8'
    const delivered = this.expectAppend(event => event.type === 'team/message/delivered')
    this.openHold('notes-mail')
    await this.consumeWaitedWithoutSettle(delivered, signal, 'notes mail delivery (team/message/delivered)')
    const claim = this.expectAppend(event => this.isTaskStatus(event, 'in_progress'))
    this.openHold('summary-claim')
    await this.consumeWaitedWithoutSettle(claim, signal, 'summary task-2 claim (team/task in_progress)')
    this.phase = 'idle'
  }

  /** Lead call 9 (step 9): the notes settlement splice must land first. */
  private async leadCall9Gate(signal: AbortSignal | undefined): Promise<void> {
    const notesId = this.liveChildId(1)
    const splice = this.expectSettlement(notesId)
    this.openHold('notes-final-stream')
    await this.bounded(splice, signal, 'notes settlement splice (agent/inbox/spliced)')
  }

  /** Lead call 12 (step 12): the summary mail must be delivered first. */
  private async leadCall12Gate(signal: AbortSignal | undefined): Promise<void> {
    const delivered = this.expectAppend(event => event.type === 'team/message/delivered')
    this.openHold('summary-mail')
    await this.consumeWaitedWithoutSettle(delivered, signal, 'summary mail delivery (team/message/delivered)')
  }

  /** Lead call 13 (step 13): the summary settlement splice must land first. */
  private async leadCall13Gate(signal: AbortSignal | undefined): Promise<void> {
    const summaryId = this.liveChildId(2)
    const splice = this.expectSettlement(summaryId)
    this.openHold('summary-final-stream')
    await this.bounded(splice, signal, 'summary settlement splice (agent/inbox/spliced)')
  }

  // --- wait release ---

  /**
   * Release one recorded wait. Teammate waits must be the summary-writer's
   * call-6 entry (the gate armed `summaryArmed`); Lead waits follow the
   * recorded order exactly and a fourth one fails loud.
   */
  private async releaseFor(caller: Agent, signal: AbortSignal): Promise<void> {
    const membership = this.teams?.tryMembership(caller)
    if (membership === undefined) {
      throw new Error(`${TAG}: waitForChange from a caller outside the live Team`)
    }
    if (membership.role === 'teammate') {
      if (membership.name !== SUMMARY_WRITER) {
        throw new Error(`${TAG}: unexpected waitForChange from Team member "${membership.name}"`)
      }
      const armed = this.summaryArmed
      if (armed === undefined) {
        throw new Error(`${TAG}: unexpected ${SUMMARY_WRITER} waitForChange — no gate is waiting for it`)
      }
      this.summaryArmed = undefined
      armed.resolve()
      return
    }
    const waitIndex = this.leadWaitIndex
    this.leadWaitIndex += 1
    await this.bounded(this.leadWaitAction(waitIndex), signal, `Lead wait #${waitIndex + 1} release`)
  }

  private async leadWaitAction(waitIndex: number): Promise<void> {
    switch (waitIndex) {
      case 0: {
        // Lead step 6: notes may complete task-1 now; the completion append is
        // the wake edge for both this wait and the summary-writer's wait.
        const completed = this.expectAppend(event => this.isTaskStatus(event, 'completed'))
        this.openHold('notes-complete')
        await this.consumeWaitedWithoutSettle(completed, undefined, 'notes task-1 completion (team/task completed)')
        return
      }
      case 1: {
        // Lead step 8: deliver the parked call-8 claim notification. Nothing
        // else starts here — the wait's own notify is the release.
        const gate = this.stepEightGate
        if (gate === undefined) {
          throw new Error(`${TAG}: Lead wait #2 arrived but no call-8 flush is parked — the recorded schedule broke`)
        }
        this.stepEightGate = undefined
        clearTimeout(this.stepEightWatchdog)
        this.stepEightWatchdog = undefined
        gate.resolve()
        return
      }
      case 2: {
        // Lead step 10: summary may complete task-2 now.
        const completed = this.expectAppend(event => this.isTaskStatus(event, 'completed'))
        this.openHold('summary-complete')
        await this.consumeWaitedWithoutSettle(completed, undefined, 'summary task-2 completion (team/task completed)')
        return
      }
      default:
        throw new Error(`${TAG}: unexpected Lead wait #${waitIndex + 1} — the recorded fixture has exactly three Lead waitForChange calls`)
    }
  }

  // --- observers ---

  /**
   * Lead-session append observer. Every journal-appended team event pushes one
   * flush-settle witness (FIFO with the store's flush calls); during the call-8
   * window a team/task append additionally arms the one-shot flush park.
   *
   * Only the task-2 claim's flush parks. The queued mail flush must not park —
   * parking it suspends the send transaction before `tryDispatch` runs, so the
   * steer splice and the delivered row could never happen. The delivered flush
   * must not park either — parking it suspends `markDelivered`'s journal
   * transaction, which holds the root's transaction tail and would block the
   * claim append that must land before the Lead's step-8 assistant message.
   */
  private readonly onSessionEvent = (session: Session, event: SessionEvent): void => {
    if (this.disposed || !this.installed || session.id !== this.leadSessionId) return
    if (
      event.type === 'team/member' || event.type === 'team/task'
      || event.type === 'team/message/queued' || event.type === 'team/message/delivered'
    ) {
      const settle = this.pushSettle(session.id)
      if (this.phase === 'call8' && event.type === 'team/task') this.parkArmed = true
      this.dispatchAppendWaiters(event, settle)
      return
    }
    if (event.type === 'agent/inbox/spliced') this.dispatchSettlementWaiters(event)
  }

  /**
   * Teammate tool gate: hold the recorded occurrences of the recorded tool
   * names until their gate opens, then let the real tool run (`next()` is
   * always reached). Unknown Team members, unexpected tool names on held
   * members, and occurrences beyond the table fail loud.
   */
  private readonly onPreExecute = async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    if (this.disposed || !this.installed || exec.agent === undefined) return await next()
    const membership = this.teams?.tryMembership(exec.agent)
    if (membership === undefined || membership.role !== 'teammate') return await next()
    const holdName = this.matchHold(membership.name, exec.name)
    if (holdName === undefined) return await next()
    await this.bounded(this.hold(holdName).promise, exec.signal, `tool hold ${holdName} (${membership.name} ${exec.name})`)
    return await next()
  }

  // --- plumbing ---

  private matchHold(memberName: string, toolName: string): HoldName | undefined {
    const table = MEMBER_TOOL_HOLDS[memberName]
    if (table === undefined) {
      throw new Error(
        `${TAG}: unexpected Team member "${memberName}" — the recorded fixture has "${NOTES_WRITER}" and "${SUMMARY_WRITER}" only`,
      )
    }
    const holds = table[toolName]
    if (holds === undefined) return undefined
    const key = `${memberName}:${toolName}`
    const occurrence = this.holdCounts.get(key) ?? 0
    this.holdCounts.set(key, occurrence + 1)
    const holdName = holds[occurrence]
    if (holdName === undefined) {
      throw new Error(
        `${TAG}: unexpected occurrence #${occurrence + 1} of ${toolName} from ${memberName} — the recorded fixture holds fewer calls`,
      )
    }
    return holdName === 'pass' ? undefined : holdName
  }

  private expectAppend(match: (event: SessionEvent) => boolean): Promise<WaitedAppend> {
    const done = deferred<WaitedAppend>()
    this.appendWaiters.push({ match, done })
    return done.promise
  }

  private expectSettlement(senderSessionId: string): Promise<void> {
    const done = deferred<void>()
    this.settlementWaiters.push({ senderSessionId, done })
    return done.promise
  }

  private dispatchSettlementWaiters(event: Extract<SessionEvent, { type: 'agent/inbox/spliced' }>): void {
    const first = event.data.inserted[0]
    if (first === undefined || first.source.kind !== 'subagent-settled') return
    for (let index = this.settlementWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.settlementWaiters[index]
      if (waiter === undefined || waiter.senderSessionId !== first.source.senderSessionId) continue
      this.settlementWaiters.splice(index, 1)
      waiter.done.resolve()
    }
  }

  /** Await a registered append waiter, then its flush settle (when required). */
  private async consumeWaited(
    waited: Promise<WaitedAppend>,
    signal: AbortSignal | undefined,
    label: string,
  ): Promise<void> {
    const waitedAppend = await this.bounded(waited, signal, label)
    await this.bounded(waitedAppend.settle.promise, signal, `${label} flush settle`)
  }

  /** Await a registered append waiter without its settle (parked windows). */
  private async consumeWaitedWithoutSettle(
    waited: Promise<WaitedAppend>,
    signal: AbortSignal | undefined,
    label: string,
  ): Promise<void> {
    await this.bounded(waited, signal, label)
  }

  private dispatchAppendWaiters(event: SessionEvent, settle: Deferred<void>): void {
    for (let index = this.appendWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.appendWaiters[index]
      if (waiter === undefined || !waiter.match(event)) continue
      this.appendWaiters.splice(index, 1)
      waiter.done.resolve({ event, settle })
    }
  }

  private isTaskStatus(event: SessionEvent, status: 'in_progress' | 'completed'): boolean {
    return event.type === 'team/task' && event.data.task.status === status
  }

  private pushSettle(sessionId: string): Deferred<void> {
    const settle = deferred<void>()
    const queue = this.settles.get(sessionId)
    if (queue === undefined) this.settles.set(sessionId, [settle])
    else queue.push(settle)
    return settle
  }

  private shiftSettle(sessionId: string): Deferred<void> | undefined {
    return this.settles.get(sessionId)?.shift()
  }

  private armStepEightGate(): Deferred<void> {
    const gate = deferred<void>()
    const watchdog = setTimeout(() => {
      gate.reject(new Error(
        `${TAG}: the call-8 task-claim flush stayed parked past ${this.watchdogMs}ms `
        + '— the Lead step-8 wait never released it',
      ))
    }, this.watchdogMs)
    watchdog.unref()
    this.stepEightWatchdog = watchdog
    return gate
  }

  private openHold(holdName: HoldName): void {
    this.hold(holdName).resolve()
  }

  private hold(holdName: HoldName): Deferred<void> {
    return this.holds[holdName]
  }

  private liveChildId(scriptIndex: number): string {
    const id = this.deps.liveSessionIds[scriptIndex]
    if (id === undefined) {
      throw new Error(`${TAG}: child script #${scriptIndex} never bound to a live session before its settlement was expected`)
    }
    return id
  }

  /**
   * Bounded await: races the promise against dispose, an optional abort signal,
   * and the schedule watchdog, so every driver wait fails with a crisp error
   * instead of hanging past a recorded timeout.
   */
  private bounded<T>(promise: Promise<T>, signal: AbortSignal | undefined, label: string): Promise<T> {
    const watchdog = deferred<never>()
    const timer = setTimeout(() => {
      watchdog.reject(new Error(`${TAG}: ${label} did not settle within ${this.watchdogMs}ms — the recorded causal schedule broke`))
    }, this.watchdogMs)
    timer.unref()
    const abort = abortOf(signal)
    return Promise.race([promise, this.disposeGate.promise, watchdog.promise, abort.promise])
      .finally(() => {
        clearTimeout(timer)
        abort.dispose()
      })
  }
}
