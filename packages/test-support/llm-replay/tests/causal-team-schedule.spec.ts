import { describe, expect, it, vi } from 'vitest'
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { TeamId, TeamMessageId, TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team'
import {
  CausalTeamScheduleDriver,
  type ScheduleHost,
  type TeamMembershipView,
  type TeamScheduleSeam,
} from '../src/causal-team-schedule.ts'
import type { SessionScript } from '../src/index.ts'

const LEAD_SESSION = 'lead-live' as SessionId
const NOTES_SESSION = 'notes-live' as SessionId
const SUMMARY_SESSION = 'summary-live' as SessionId

/**
 * Public-`Agent`-typed test double built with the maintained testkit's
 * unsupported Inbox stub. Only `id` is observed by the driver and the fakes;
 * the remaining members exist so the double satisfies the exact live-Agent
 * contract the real Team service demands instead of an id-only stand-in.
 */
function agentStub(id: SessionId): Agent {
  return {
    model: { current: () => undefined, select: () => {}, origin: () => null },
    id,
    options: {},
    session: sessionOf(id),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: new Context(),
    cancel() {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: operation => operation(new AbortController().signal),
    send() {},
    followup() {},
    steer() {},
    inject() {},
  }
}

const LEAD_AGENT = agentStub('agent-lead' as SessionId)
const NOTES_AGENT = agentStub('agent-notes' as SessionId)
const SUMMARY_AGENT = agentStub('agent-summary' as SessionId)
const OTHER_AGENT = agentStub('agent-other' as SessionId)

/**
 * Return the raw Service instance behind the traceable proxy — the test-side
 * twin of the driver's `symbols.original` unwrap, used to simulate a later
 * owner writing the same instance.
 */
function rawServiceOf(receiver: ReplaySpecTeamService): ReplaySpecTeamService {
  const original: unknown = Reflect.get(receiver, symbols.original)
  return typeof original === 'object' && original !== null ? original as ReplaySpecTeamService : receiver
}

type SessionEventListener = (session: Session, event: SessionEvent) => void
type PreExecuteListener = (exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>

interface Harness {
  driver: CausalTeamScheduleDriver
  /** The fake original flush; each call stays pending until `releaseFlush`. */
  flushSessionIds: string[]
  releaseFlush(): void
  /** Caller ids observed by the original (unwrapped) `waitForChange`. */
  waitCallers: string[]
  append(event: SessionEvent, sessionId?: SessionId): void
  /** Simulate the journal's flush for the lead session (through the wrapper). */
  flushLead(): Promise<boolean>
  runPreExecute(agentId: SessionId | undefined, toolName: string): Promise<PreToolDecision>
  /** Call the (possibly wrapped) `waitForChange` as the given agent. */
  wrappedWait(callerId: SessionId): Promise<{ timedOut: boolean }>
  /** Call the (possibly wrapped) `waitForChange` with an arbitrary agent double. */
  waitAs(agent: Agent): Promise<{ timedOut: boolean }>
}

let seqCounter = 0

function nextSeq(): SessionSeq {
  seqCounter += 1
  return seqCounter as SessionSeq
}

function taskEvent(status: 'in_progress' | 'completed', revision: number): SessionEvent {
  return {
    type: 'team/task',
    seq: nextSeq(),
    time: 0,
    data: {
      version: 2,
      teamId: 'team-1' as TeamId,
      task: {
        id: 'task-1' as TeamTaskId,
        revision,
        subject: 'subject',
        description: 'description',
        status,
        blockedBy: [],
        writeScopes: [],
      },
    },
  }
}

function messageQueuedEvent(): SessionEvent {
  return {
    type: 'team/message/queued',
    seq: nextSeq(),
    time: 0,
    data: {
      version: 2,
      teamId: 'team-1' as TeamId,
      message: {
        id: 'msg-1' as TeamMessageId,
        senderId: NOTES_SESSION,
        senderName: 'notes-writer',
        targetId: LEAD_SESSION,
        content: [],
      },
    },
  }
}

function messageDeliveredEvent(): SessionEvent {
  return {
    type: 'team/message/delivered',
    seq: nextSeq(),
    time: 0,
    data: { version: 2, teamId: 'team-1' as TeamId, messageId: 'msg-1' as TeamMessageId, targetId: LEAD_SESSION },
  }
}

function spliceEvent(senderSessionId: SessionId): SessionEvent {
  return {
    type: 'agent/inbox/spliced',
    seq: nextSeq(),
    time: 0,
    data: {
      target: 'next-turn',
      start: 0,
      inserted: [createUserMessage({
        content: [{ type: 'text', text: 'Background subagent settled' }],
        source: { kind: 'subagent-settled', form: 'notice', summary: 'settled', senderSessionId },
      })],
    },
  }
}

/** A removal-only splice: it inserts nothing and must never match a settlement wait. */
function emptySpliceEvent(): SessionEvent {
  return {
    type: 'agent/inbox/spliced',
    seq: nextSeq(),
    time: 0,
    data: { target: 'next-turn', start: 0, inserted: [] },
  }
}

/** An ordinary non-team, non-splice event the driver must ignore entirely. */
function turnStartEvent(): SessionEvent {
  return { type: 'turn/start', seq: nextSeq(), time: 0, data: { turn: 1 } }
}

function sessionOf(id: SessionId): Session {
  return { id } as Session
}

function execOf(agentId: SessionId | undefined, toolName: string): ToolExecution {
  const exec: ToolExecution = {
    name: toolName,
    signal: new AbortController().signal,
  } as ToolExecution
  if (agentId !== undefined) {
    return { ...exec, agent: agentStub(agentId) }
  }
  return exec
}

function scriptOf(recordedId: string, createdAt: number, calls: number): SessionScript {
  return {
    recordedId,
    createdAt,
    primary: recordedId === 'lead-recorded',
    entries: Array.from({ length: calls }, () => ({ kind: 'chunks' as const, chunks: [] })),
  }
}

const SCRIPTS = [
  scriptOf('lead-recorded', 1, 16),
  scriptOf('notes-recorded', 2, 8),
  scriptOf('summary-recorded', 3, 13),
] as const

/** A fully typed model-call input; the driver reads only `sessionId` and `signal`. */
function callOf(sessionId: SessionId, signal?: AbortSignal): GenerateOptions {
  return {
    provider: 'mock',
    model: 'mock',
    messages: [],
    sessionId,
    ...signal !== undefined ? { signal } : {},
  }
}

function membershipOf(agentId: SessionId): TeamMembershipView | undefined {
  if (agentId === LEAD_AGENT.id) return { role: 'lead', name: 'lead' }
  if (agentId === NOTES_AGENT.id) return { role: 'teammate', name: 'notes-writer' }
  if (agentId === SUMMARY_AGENT.id) return { role: 'teammate', name: 'summary-writer' }
  if (agentId === OTHER_AGENT.id) return { role: 'teammate', name: 'other-member' }
  return undefined
}

function makeHarness(
  liveSessionIds: readonly (string | undefined)[] = [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
): Harness {
  const sessionEventListeners: SessionEventListener[] = []
  const preExecuteListeners: PreExecuteListener[] = []
  const waitCallers: SessionId[] = []
  const flushSessionIds: string[] = []
  let releaseFlush: (() => void) | undefined

  const teams: TeamScheduleSeam = {
    waitForChange: caller => new Promise(() => {
      // The fake original never resolves: a released wait must surface through
      // the real pending promise, never a fabricated result.
      waitCallers.push(caller.id)
    }),
    tryMembership: agent => membershipOf(agent.id),
  }
  const store = {
    flush(session: Session): Promise<boolean> {
      flushSessionIds.push(session.id)
      return new Promise<boolean>((resolve) => { releaseFlush = () => { resolve(true) } })
    },
  }
  const host: ScheduleHost = {
    teamService: () => teams,
    sessionStore: () => store,
    onSessionEvent: (listener) => {
      sessionEventListeners.push(listener)
      return () => {
        const index = sessionEventListeners.indexOf(listener)
        if (index >= 0) sessionEventListeners.splice(index, 1)
      }
    },
    onPreExecute: (listener) => {
      preExecuteListeners.push(listener)
      return () => {
        const index = preExecuteListeners.indexOf(listener)
        if (index >= 0) preExecuteListeners.splice(index, 1)
      }
    },
  }
  const driver = new CausalTeamScheduleDriver({
    host,
    scripts: [...SCRIPTS],
    liveSessionIds: [...liveSessionIds],
    watchdogMs: 150,
  })
  const next = async (): Promise<PreToolDecision> => ({ kind: 'allow' })
  return {
    driver,
    flushSessionIds,
    releaseFlush: () => releaseFlush?.(),
    waitCallers,
    append(event: SessionEvent, sessionId: SessionId = LEAD_SESSION): void {
      for (const listener of [...sessionEventListeners]) listener(sessionOf(sessionId), event)
    },
    flushLead(): Promise<boolean> {
      return store.flush(sessionOf(LEAD_SESSION))
    },
    runPreExecute(agentId, toolName): Promise<PreToolDecision> {
      const listener = preExecuteListeners[preExecuteListeners.length - 1]
      if (listener === undefined) throw new Error('no pre-execute listener installed')
      return listener(execOf(agentId, toolName), next)
    },
    wrappedWait(callerId): Promise<{ timedOut: boolean }> {
      return teams.waitForChange(
        callerId === LEAD_AGENT.id ? LEAD_AGENT : callerId === NOTES_AGENT.id ? NOTES_AGENT : SUMMARY_AGENT,
        60_000,
        new AbortController().signal,
      )
    },
    waitAs(agent: Agent): Promise<{ timedOut: boolean }> {
      return teams.waitForChange(agent, 60_000, new AbortController().signal)
    },
  }
}

/** Install (lead call 0) and drive the call-6 gate to completion. */
async function driveCall6Gate(h: Harness): Promise<void> {
  await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
  const gate = h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION))
  await h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
  h.append(taskEvent('in_progress', 2))
  const flush = h.flushLead()
  h.releaseFlush()
  await flush
  await h.runPreExecute(SUMMARY_AGENT.id, 'team_task_list')
  void h.wrappedWait(SUMMARY_AGENT.id)
  await gate
}

/**
 * Drive the call-8 gate and park the task-2 claim flush WITHOUT releasing the
 * step-8 wait. Returns `{ parkedFlush }` in a wrapper object: an async function
 * adopts a bare returned promise, so returning the flush promise directly would
 * make the caller await its settlement (the release this helper must NOT
 * perform) instead of its creation.
 */
async function parkClaimFlush(h: Harness): Promise<{ parkedFlush: Promise<boolean> }> {
  const gate = h.driver.beforeModelCall(0, 7, callOf(LEAD_SESSION))
  await h.runPreExecute(NOTES_AGENT.id, 'send_message')
  h.append(messageQueuedEvent())
  const queuedFlush = h.flushLead()
  h.releaseFlush()
  await expect(queuedFlush).resolves.toBe(true)
  h.append(messageDeliveredEvent())
  const deliveredFlush = h.flushLead()
  h.releaseFlush()
  await expect(deliveredFlush).resolves.toBe(true)
  await h.runPreExecute(SUMMARY_AGENT.id, 'team_task_update')
  h.append(taskEvent('in_progress', 2))
  await gate
  const parkedFlush = h.flushLead()
  h.releaseFlush()
  return { parkedFlush }
}

/** Drive the call-8 window: mail, claim park, and the step-8 wait release. */
async function driveCall8Window(h: Harness): Promise<void> {
  void h.wrappedWait(LEAD_AGENT.id)
  await h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
  h.append(taskEvent('completed', 3))
  const { parkedFlush } = await parkClaimFlush(h)
  let parkedSettled = false
  void parkedFlush.then(() => { parkedSettled = true })
  await Promise.resolve()
  expect(parkedSettled).toBe(false)
  void h.wrappedWait(LEAD_AGENT.id)
  await expect(parkedFlush).resolves.toBe(true)
}

/** Drive the call-8 window plus the step-10 summary completion wait. */
async function driveToAfterLeadWait3(h: Harness): Promise<void> {
  await driveCall8Window(h)
  void h.wrappedWait(LEAD_AGENT.id)
  await h.runPreExecute(SUMMARY_AGENT.id, 'team_task_update')
  h.append(taskEvent('completed', 4))
}

/** Cordis-backed host seams for the real-Service regression, mirroring the live wiring. */
function cordisHost(ctx: Context): ScheduleHost {
  return {
    teamService: () => ctx.get('replaySpecTeams', false),
    sessionStore: () => {
      const store = ctx.get('replaySpecStore', false)
      if (store === undefined) throw new Error('replaySpecStore did not mount')
      return store
    },
    onSessionEvent: () => () => {},
    onPreExecute: () => async () => ({ kind: 'allow' }),
  }
}

/**
 * Real Cordis Service exposing the Team seam, mounted through the real plugin
 * registry so `ctx.get` returns the traceable proxy the live wiring sees.
 */
class ReplaySpecTeamService extends Service {
  /** Caller ids observed by the original (unwrapped) `waitForChange`. */
  readonly waitCallers: SessionId[] = []

  constructor(ctx: Context) {
    super(ctx, 'replaySpecTeams')
  }

  async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<{ timedOut: boolean }> {
    if (timeoutMs < 0) throw new Error('negative wait timeout')
    signal.throwIfAborted()
    this.waitCallers.push(caller.id)
    return { timedOut: false }
  }

  tryMembership(agent: Agent): TeamMembershipView | undefined {
    return membershipOf(agent.id)
  }
}

/** Real Cordis Service exposing the flush seam. */
class ReplaySpecStore extends Service {
  /** Session ids observed by the original (unwrapped) `flush`. */
  readonly flushed: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'replaySpecStore')
  }

  async flush(session: Session): Promise<boolean> {
    this.flushed.push(session.id)
    return true
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    replaySpecTeams: ReplaySpecTeamService
    replaySpecStore: ReplaySpecStore
  }
}

describe('causal team schedule driver', () => {
  it('rejects a fixture with wrong call counts at construction', () => {
    expect(() => new CausalTeamScheduleDriver({
      host: {
        teamService: () => undefined,
        sessionStore: () => ({ flush: async () => true }),
        onSessionEvent: () => () => {},
        onPreExecute: () => async () => ({ kind: 'allow' }),
      },
      scripts: [scriptOf('lead-recorded', 1, 15), scriptOf('notes-recorded', 2, 8), scriptOf('summary-recorded', 3, 13)],
      liveSessionIds: [],
    })).toThrow(/requires 16/)
  })

  it('fails loud when the scenario has no Team service', async () => {
    const driver = new CausalTeamScheduleDriver({
      host: {
        teamService: () => undefined,
        sessionStore: () => ({ flush: async () => true }),
        onSessionEvent: () => () => {},
        onPreExecute: () => async () => ({ kind: 'allow' }),
      },
      scripts: [...SCRIPTS],
      liveSessionIds: [],
    })
    await expect(driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))).rejects.toThrow(/no agentTeams service/)
    driver.dispose()
  })

  it('unwinds a model call waiting for a child settlement when its driver is disposed', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const waiting = h.driver.beforeModelCall(0, 8, callOf(LEAD_SESSION))
    h.driver.dispose()
    await expect(waiting).rejects.toThrow('driver disposed')
  })

  it('delegates an ordinary flush without an append witness or a parked claim', async () => {
    const h = makeHarness()
    try {
      await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
      const flushing = h.flushLead()
      h.releaseFlush()
      await expect(flushing).resolves.toBe(true)
      expect(h.flushSessionIds).toEqual([LEAD_SESSION])
    } finally { h.driver.dispose() }
  })

  it('gates lead call 6 on the claim append, its flush settle, and the summary wait entry', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    let gateSettled = false
    const gate = h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION)).then(() => { gateSettled = true })
    await h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    h.append(taskEvent('in_progress', 2))
    await Promise.resolve()
    // The append alone is not enough: the gate also awaits the flush settle.
    expect(gateSettled).toBe(false)
    const flush = h.flushLead()
    h.releaseFlush()
    await flush
    await h.runPreExecute(SUMMARY_AGENT.id, 'team_task_list')
    void h.wrappedWait(SUMMARY_AGENT.id)
    await gate
    expect(gateSettled).toBe(true)
    expect(h.waitCallers).toEqual([SUMMARY_AGENT.id])
    h.driver.dispose()
  })

  it('registers the real waiter before releasing and never fakes the wait result', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const gate = h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION))
    await h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
    h.append(taskEvent('in_progress', 2))
    const flush = h.flushLead()
    h.releaseFlush()
    await flush
    await h.runPreExecute(SUMMARY_AGENT.id, 'team_task_list')
    // The gate completes only through the real wrapped wait entry below.
    const wait = h.wrappedWait(SUMMARY_AGENT.id)
    await gate
    expect(h.waitCallers).toEqual([SUMMARY_AGENT.id])
    let waitSettled = false
    void wait.then(() => { waitSettled = true })
    await Promise.resolve()
    // The fake original never resolves — the wrapped wait must not fabricate one.
    expect(waitSettled).toBe(false)
    h.driver.dispose()
  })

  it('parks only the task-2 claim flush; queued and delivered flushes run normally', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    await driveCall8Window(h)
    h.driver.dispose()
  })

  it('waits for the matching settlement splice and ignores the other child', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    await driveCall8Window(h)
    const gate = h.driver.beforeModelCall(0, 8, callOf(LEAD_SESSION))
    // A splice from the wrong child must not release the gate.
    h.append(spliceEvent(SUMMARY_SESSION))
    let gateSettled = false
    void gate.then(() => { gateSettled = true })
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    h.append(spliceEvent(NOTES_SESSION))
    await gate
    h.driver.dispose()
  })

  it('fails loud on an unexpected fourth lead wait', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    await driveToAfterLeadWait3(h)
    await expect(h.wrappedWait(LEAD_AGENT.id)).rejects.toThrow(/unexpected Lead wait #4/)
    h.driver.dispose()
  })

  it('fails loud on a teammate wait with no armed gate', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.wrappedWait(SUMMARY_AGENT.id)).rejects.toThrow(/no gate is waiting/)
    h.driver.dispose()
  })

  it('fails loud on tool hold overflow while unheld tools pass through', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    // Occurrence 2 (notes-complete) stays held until its gate opens.
    const held = h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
    held.catch(() => {})
    await expect(h.runPreExecute(NOTES_AGENT.id, 'team_task_update')).rejects.toThrow(/occurrence #3/)
    await expect(h.runPreExecute(NOTES_AGENT.id, 'write')).resolves.toEqual({ kind: 'allow' })
    await expect(h.runPreExecute(undefined, 'team_task_list')).resolves.toEqual({ kind: 'allow' })
    h.driver.dispose()
  })

  it('rejects a gate on abort instead of hanging', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const controller = new AbortController()
    const gate = h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION, controller.signal))
    controller.abort(new Error('turn aborted'))
    await expect(gate).rejects.toThrow(/turn aborted/)
    h.driver.dispose()
  })

  it('fails a stuck release through the watchdog instead of a recorded timeout', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    // Lead wait #1 opens notes-complete, but no completion append arrives.
    await expect(h.wrappedWait(LEAD_AGENT.id)).rejects.toThrow(/schedule broke/)
    h.driver.dispose()
  })

  it('dispose rejects pending gates and restores the plain harness methods', async () => {
    const store = {
      flush: async (session: Session): Promise<boolean> => session.id === LEAD_SESSION,
    }
    const teams: TeamScheduleSeam = {
      waitForChange: async () => ({ timedOut: false }),
      tryMembership: () => undefined,
    }
    let owned = true
    const driver = new CausalTeamScheduleDriver({
      host: {
        teamService: () => teams,
        sessionStore: () => store,
        onSessionEvent: () => () => {},
        onPreExecute: () => () => { owned = false },
      },
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const gate = driver.beforeModelCall(0, 5, callOf(LEAD_SESSION))
    driver.dispose()
    await expect(gate).rejects.toThrow(/driver disposed/)
    expect(owned).toBe(false)
    await expect(store.flush(sessionOf(LEAD_SESSION))).resolves.toBe(true)
  })

  it('wraps and restores real Cordis Service methods across install, dispose, and reapply', async () => {
    const ctx = new Context()
    await ctx.plugin(ReplaySpecStore)
    await ctx.plugin(ReplaySpecTeamService)
    const host = cordisHost(ctx)
    const driver = new CausalTeamScheduleDriver({
      host,
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))

    // The wrapper is live through a fresh ctx.get proxy read: the call reaches
    // the original (the wrapper registers the real waiter first), then the
    // driver's release path rejects the recorded-but-unarmed wait.
    const wrapped = ctx.get('replaySpecTeams', false)
    if (wrapped === undefined) throw new Error('replaySpecTeams did not mount')
    await expect(wrapped.waitForChange(SUMMARY_AGENT, 60_000, new AbortController().signal))
      .rejects.toThrow(/no gate is waiting/)
    expect(wrapped.waitCallers).toEqual([SUMMARY_AGENT.id])
    // The replacement is an own property of the raw instance, not the proxy.
    expect(Object.hasOwn(wrapped, 'waitForChange')).toBe(true)

    driver.dispose()
    // Restore deleted the own wrapper: a fresh proxy read reaches the original.
    const restored = ctx.get('replaySpecTeams', false)
    if (restored === undefined) throw new Error('replaySpecTeams did not mount')
    await expect(restored.waitForChange(SUMMARY_AGENT, 60_000, new AbortController().signal))
      .resolves.toEqual({ timedOut: false })
    expect(restored.waitCallers).toEqual([SUMMARY_AGENT.id, SUMMARY_AGENT.id])
    expect(Object.hasOwn(restored, 'waitForChange')).toBe(false)
    const store = ctx.get('replaySpecStore', false)
    if (store === undefined) throw new Error('replaySpecStore did not mount')
    await expect(store.flush(sessionOf(LEAD_SESSION))).resolves.toBe(true)
    expect(store.flushed).toEqual([LEAD_SESSION])

    // HMR reapply: a second install wraps the restored prototype method and
    // its dispose restores it again.
    const second = new CausalTeamScheduleDriver({
      host,
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await second.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(restored.waitForChange(SUMMARY_AGENT, 60_000, new AbortController().signal))
      .rejects.toThrow(/no gate is waiting/)
    expect(restored.waitCallers).toEqual([SUMMARY_AGENT.id, SUMMARY_AGENT.id, SUMMARY_AGENT.id])
    second.dispose()
    await expect(restored.waitForChange(SUMMARY_AGENT, 60_000, new AbortController().signal))
      .resolves.toEqual({ timedOut: false })
    expect(restored.waitCallers).toEqual([SUMMARY_AGENT.id, SUMMARY_AGENT.id, SUMMARY_AGENT.id, SUMMARY_AGENT.id])
    expect(Object.hasOwn(restored, 'waitForChange')).toBe(false)
  })

  it('leaves a later owner’s replacement in place when it disposes', async () => {
    const ctx = new Context()
    await ctx.plugin(ReplaySpecStore)
    await ctx.plugin(ReplaySpecTeamService)
    const receiver = ctx.get('replaySpecTeams', false)
    if (receiver === undefined) throw new Error('replaySpecTeams did not mount')
    const driver = new CausalTeamScheduleDriver({
      host: cordisHost(ctx),
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    // A later owner replaces the driver's wrapper on the raw instance.
    const raw = rawServiceOf(receiver)
    const later = async (): Promise<{ timedOut: boolean }> => ({ timedOut: true })
    raw.waitForChange = later
    driver.dispose()
    // A later owner's replacement on the raw instance survives the restore.
    expect(Object.getOwnPropertyDescriptor(raw, 'waitForChange')?.value).toBe(later)
  })

  it('rejects a fixture with the wrong session count at construction', () => {
    expect(() => new CausalTeamScheduleDriver({
      host: {
        teamService: () => undefined,
        sessionStore: () => ({ flush: async () => true }),
        onSessionEvent: () => () => {},
        onPreExecute: () => async () => ({ kind: 'allow' }),
      },
      scripts: [scriptOf('lead-recorded', 1, 16), scriptOf('notes-recorded', 2, 8)],
      liveSessionIds: [],
    })).toThrow(/requires exactly 3/)
  })

  it('rejects a non-chunks entry at construction', () => {
    const notesScript: SessionScript = {
      ...scriptOf('notes-recorded', 2, 8),
      entries: [
        { kind: 'throw', chunks: [], message: 'boom', code: 'X' },
        ...Array.from({ length: 7 }, () => ({ kind: 'chunks' as const, chunks: [] })),
      ],
    }
    expect(() => new CausalTeamScheduleDriver({
      host: {
        teamService: () => undefined,
        sessionStore: () => ({ flush: async () => true }),
        onSessionEvent: () => () => {},
        onPreExecute: () => async () => ({ kind: 'allow' }),
      },
      scripts: [scriptOf('lead-recorded', 1, 16), notesScript, scriptOf('summary-recorded', 3, 13)],
      liveSessionIds: [],
    })).toThrow(/only supports the all-chunks recorded fixture/)
  })

  it('rejects every model call after dispose and stays idempotent', async () => {
    const h = makeHarness()
    h.driver.dispose()
    await expect(h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION)))
      .rejects.toThrow(/driver disposed before the schedule completed/)
    // A second dispose is a no-op, not a crash.
    expect(() => { h.driver.dispose() }).not.toThrow()
  })

  it('fails loud when the first lead call carries no session id', async () => {
    const h = makeHarness()
    const options: GenerateOptions = { provider: 'mock', model: 'mock', messages: [] }
    await expect(h.driver.beforeModelCall(0, 0, options))
      .rejects.toThrow(/no session id/)
    h.driver.dispose()
  })

  it('fails loud when a different session requests the Lead script', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.driver.beforeModelCall(0, 1, callOf('other-live' as SessionId)))
      .rejects.toThrow(/different session requested/)
    h.driver.dispose()
  })

  it('fails loud on an unknown script index', async () => {
    const h = makeHarness()
    await expect(h.driver.beforeModelCall(5, 0, callOf(LEAD_SESSION)))
      .rejects.toThrow(/unknown script index 5/)
    h.driver.dispose()
  })

  it('passes ungated teammate calls straight through', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    // Call 0 of the notes script is not its closing stream: no hold applies.
    await expect(h.driver.beforeModelCall(1, 0, callOf(NOTES_SESSION))).resolves.toBeUndefined()
    h.driver.dispose()
  })

  it('holds both teammates\' closing streams until the schedule completes them', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const notesStream = h.driver.beforeModelCall(1, 7, callOf(NOTES_SESSION))
    const summaryStream = h.driver.beforeModelCall(2, 12, callOf(SUMMARY_SESSION))
    let notesSettled = false
    // A rejection handler in `then` keeps the derived promise handled; the
    // rejects matchers below still observe the dispose rejection.
    void notesStream.then(() => { notesSettled = true }, () => {})
    await Promise.resolve()
    expect(notesSettled).toBe(false)
    h.driver.dispose()
    void summaryStream.catch(() => {})
    await expect(notesStream).rejects.toThrow(/driver disposed/)
    await expect(summaryStream).rejects.toThrow(/driver disposed/)
  })

  it('rejects a gate on an already-aborted signal before any predecessor lands', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const controller = new AbortController()
    controller.abort(new Error('pre-aborted'))
    await expect(h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION, controller.signal)))
      .rejects.toThrow(/pre-aborted/)
    h.driver.dispose()
  })

  it('fails loud at install when a service method is not replaceable', async () => {
    const teams: TeamScheduleSeam = {
      waitForChange: async () => ({ timedOut: false }),
      tryMembership: () => undefined,
    }
    // The descriptor guard fires before any wrap: a non-function own value
    // must produce a crisp install error instead of a later TypeError.
    Object.defineProperty(teams, 'waitForChange', { value: 42 })
    const driver = new CausalTeamScheduleDriver({
      host: {
        teamService: () => teams,
        sessionStore: () => ({ flush: async () => true }),
        onSessionEvent: () => () => {},
        onPreExecute: () => async () => ({ kind: 'allow' }),
      },
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await expect(driver.beforeModelCall(0, 0, callOf(LEAD_SESSION)))
      .rejects.toThrow(/not a replaceable service method/)
  })

  it('fails loud on a wait from a caller outside the live Team', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.waitAs(agentStub('agent-stranger' as SessionId)))
      .rejects.toThrow(/outside the live Team/)
    h.driver.dispose()
  })

  it('fails loud on a teammate wait from the notes-writer', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.waitAs(NOTES_AGENT))
      .rejects.toThrow(/unexpected waitForChange from Team member "notes-writer"/)
    h.driver.dispose()
  })

  it('fails loud when the second Lead wait finds no parked call-8 flush', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    // Lead wait #1 releases notes-complete; the completion append settles it.
    void h.wrappedWait(LEAD_AGENT.id)
    await h.runPreExecute(NOTES_AGENT.id, 'team_task_update')
    h.append(taskEvent('completed', 3))
    // Lead wait #2 arrives with no parked flush: the recorded schedule broke.
    await expect(h.wrappedWait(LEAD_AGENT.id)).rejects.toThrow(/no call-8 flush is parked/)
    h.driver.dispose()
  })

  it('ignores lead-session events that arrive for other sessions', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const gate = h.driver.beforeModelCall(0, 5, callOf(LEAD_SESSION))
    // The claim append for a NON-lead session must not release the gate.
    h.append(taskEvent('in_progress', 2), NOTES_SESSION)
    let gateSettled = false
    void gate.then(() => { gateSettled = true }, () => {})
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    gate.catch(() => {})
    h.driver.dispose()
  })

  it('ignores non-team events while waiting for a settlement splice', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    await driveCall8Window(h)
    const gate = h.driver.beforeModelCall(0, 8, callOf(LEAD_SESSION))
    // Neither an ordinary turn event nor a wrong-child splice releases the gate.
    h.append(turnStartEvent())
    h.append(taskEvent('in_progress', 99))
    const ordinary = spliceEvent(SUMMARY_SESSION)
    if (ordinary.type !== 'agent/inbox/spliced') throw new Error('Expected inbox fixture')
    const first = ordinary.data.inserted[0]
    if (!first) throw new Error('Expected an inserted message')
    h.append({ ...ordinary, data: { ...ordinary.data, inserted: [{ ...first, source: { kind: 'user' } }] } })
    h.append(spliceEvent(SUMMARY_SESSION))
    let gateSettled = false
    void gate.then(() => { gateSettled = true })
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    h.append(spliceEvent(NOTES_SESSION))
    await gate
    h.driver.dispose()
  })

  it('does not match an empty settlement splice (a removal never settles a wait)', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    await driveCall8Window(h)
    const gate = h.driver.beforeModelCall(0, 8, callOf(LEAD_SESSION))
    // An empty inserted[] is a removal-only splice, not the notes settlement.
    h.append(emptySpliceEvent())
    let gateSettled = false
    void gate.then(() => { gateSettled = true })
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    h.append(spliceEvent(NOTES_SESSION))
    await gate
    h.driver.dispose()
  })

  it('fails loud on a tool call from an unrecorded Team member', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.runPreExecute(OTHER_AGENT.id, 'team_task_list'))
      .rejects.toThrow(/unexpected Team member "other-member"/)
    h.driver.dispose()
  })

  it('lets lead tools and pass-occurrence teammate tools through', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    // The Lead's own tool never holds.
    await expect(h.runPreExecute(LEAD_AGENT.id, 'team_task_list')).resolves.toEqual({ kind: 'allow' })
    // The summary-writer's SECOND team_task_list is a recorded pass occurrence.
    await expect(h.runPreExecute(SUMMARY_AGENT.id, 'team_task_list')).resolves.toEqual({ kind: 'allow' })
    h.driver.dispose()
  })

  it('fails loud when a child script never bound before its settlement', async () => {
    const h = makeHarness([LEAD_SESSION, undefined, undefined])
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    await expect(h.driver.beforeModelCall(0, 8, callOf(LEAD_SESSION)))
      .rejects.toThrow(/child script #1 never bound/)
    h.driver.dispose()
  })

  it('fails a claim flush parked past the schedule watchdog', async () => {
    vi.useFakeTimers()
    try {
      const h = makeHarness()
      await driveCall6Gate(h)
      const { parkedFlush } = await parkClaimFlush(h)
      // The step-8 wait never releases: the park watchdog must fail the flush.
      // Guard the rejection window before the timer advance surfaces it.
      void parkedFlush.catch(() => {})
      await vi.advanceTimersByTimeAsync(150)
      await expect(parkedFlush).rejects.toThrow(/stayed parked past 150ms/)
      h.driver.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispose clears the armed call-8 watchdog and unwinds the parked flush', async () => {
    const h = makeHarness()
    await driveCall6Gate(h)
    const { parkedFlush } = await parkClaimFlush(h)
    h.driver.dispose()
    await expect(parkedFlush).rejects.toThrow(/driver disposed/)
  })

  it('swallows a rejecting original wait through the pending guard', async () => {
    const ctx = new Context()
    await ctx.plugin(ReplaySpecStore)
    await ctx.plugin(ReplaySpecTeamService)
    const receiver = ctx.get('replaySpecTeams', false)
    if (receiver === undefined) throw new Error('replaySpecTeams did not mount')
    const driver = new CausalTeamScheduleDriver({
      host: cordisHost(ctx),
      scripts: [...SCRIPTS],
      liveSessionIds: [LEAD_SESSION, NOTES_SESSION, SUMMARY_SESSION],
    })
    await driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    // The original rejects immediately (negative timeout); the wrapper's
    // pending guard absorbs it and the release error surfaces instead.
    await expect(receiver.waitForChange(SUMMARY_AGENT, -1, new AbortController().signal))
      .rejects.toThrow(/no gate is waiting/)
    driver.dispose()
  })

  it('gates lead call 12 on the summary mail delivery', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const gate = h.driver.beforeModelCall(0, 11, callOf(LEAD_SESSION))
    let gateSettled = false
    void gate.then(() => { gateSettled = true })
    await Promise.resolve()
    expect(gateSettled).toBe(false)
    h.append(messageDeliveredEvent())
    await gate
    h.driver.dispose()
  })

  it('gates lead call 13 on the summary settlement splice', async () => {
    const h = makeHarness()
    await h.driver.beforeModelCall(0, 0, callOf(LEAD_SESSION))
    const gate = h.driver.beforeModelCall(0, 12, callOf(LEAD_SESSION))
    h.append(spliceEvent(SUMMARY_SESSION))
    await gate
    h.driver.dispose()
  })
})
