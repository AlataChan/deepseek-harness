/**
 * B1.3 observer wiring over the real production inbox and real AgentLoop
 * turns: entry evidence, claim settlement, queue absence, composer-input
 * supersession (including the accepted-pending edge), the degraded-pending
 * upgrade, and the armed question guard ride the real `session/event` and
 * agent inbox notifications. Claims and entries are produced by real turns
 * (scripted LLM, public pre-step barrier); only external nondeterminism is
 * stubbed per the admission fixture (attachments, file uploads, Typert
 * lookup seam).
 * @module tests/input-ordering
 */

import { cpSync, mkdtempSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import type { SessionPromptRequest, SessionRequestId, SessionUpdateQueueRequest } from '@deepseek-ai/dsh-api-session-controller'
import type { AdmittedPromptContentPart, AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it, onTestFinished, vi, type Mock } from 'vitest'
import SessionDecisionsService, { answerRequestId, decisionsDomain } from '../src/index.ts'
import type { SessionDecisionsConfig } from '../src/index.ts'
import * as tools from '../src/tools.ts'
import { DecisionStore } from '../src/store.ts'

const SESSION = SessionId('ordering-session')

function serviceConfig(overrides: Partial<SessionDecisionsConfig> = {}): SessionDecisionsConfig {
  return {
    enabled: true,
    feishuEnabled: false,
    defaultTtlMs: 24 * 60 * 60 * 1000,
    closedRetentionMs: 30 * 24 * 60 * 60 * 1000,
    maxRecords: 1000,
    maxQuestionBytes: 16384,
    maxChoiceLabelBytes: 512,
    maxAnswerTextBytes: 16384,
    maxChoices: 8,
    reconcileMaxEvents: 100_000,
    ...overrides,
  }
}

/** Text response script entry: one text block, usage, clean stop. */
function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One-response script entry streaming the given tool calls. */
function toolCallChunks(calls: ReadonlyArray<{ id: string; name: string; args: object }>): StreamChunk[] {
  const chunks: StreamChunk[] = []
  for (const [index, call] of calls.entries()) {
    const json = JSON.stringify(call.args)
    chunks.push(
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id: ToolCallId(call.id), name: call.name, argumentsDelta: json },
      { type: 'block-end', index, block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: json } },
    )
  }
  chunks.push(
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

/** Script entry: fixed chunks, or computed after an async gate holds. */
type ScriptEntry = StreamChunk[] | ((options: GenerateOptions) => StreamChunk[] | Promise<StreamChunk[]>)

/** Scripted LLM adapter: each model call consumes the next script entry. */
class ScriptAdapter extends LlmAdapter {
  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptAdapter: script exhausted')
    for (const chunk of typeof entry === 'function' ? await entry(options) : entry) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

async function orderingHarness(options: {
  /** Scripted real turns: register the mock LLM and no maintenance hold. */
  realTurn?: boolean
  /** Script entries consumed one per model call, in order. */
  script?: ScriptEntry[]
  /** Hold the loop behind a releasable maintenance job (pending stays pending). */
  hold?: boolean
  /** Gate the decision domain's first durable `put` until released. */
  holdFirstPut?: boolean
  /** After the gated first `put`, every later decision-domain put fails. */
  failAfterFirstPut?: boolean
  /** Durable backend rejection value for the failure probe. */
  writeFailure?: Error | string
  /** Fail every decision-domain write from the Nth counted write onward, ungated. */
  failWritesFrom?: number
  /** Persist Session logs under `<root>/sessions` so cold boots can read them. */
  sessionsPersistence?: boolean
} = {}): Promise<{
  ctx: Context
  service: SessionDecisionsService
  agent: Awaited<ReturnType<typeof loop.create>>
  followup: Mock<(message: UserMessage) => void>
  /** Release the maintenance hold; the loop then runs its pending queue. */
  release: () => void
  /** Release the held durable `put` of the decision domain. */
  releasePut: () => void
  /** Storage root, shared with a second context in cross-service tests. */
  root: string
  /** Session-log root; `undefined` only when persistence is explicitly disabled. */
  sessionsRoot: string | undefined
  /** The real public Session command controller (queue edits, prompts). */
  controller: SessionCommandController
}> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-ordering-'))
  const sessionsRoot = options.sessionsPersistence === false ? undefined : join(root, 'sessions')
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  if (sessionsRoot !== undefined) {
    await ctx.plugin(SessionPersistenceJsonl, { root: sessionsRoot, compression: 'none' })
  }
  await mountAgentLoopTestDependencies(ctx)
  if (options.realTurn) {
    ctx.llm.registerAdapter(['mock'], new ScriptAdapter(options.script ?? []))
  }
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(
    SESSION,
    options.realTurn ? { provider: 'mock', model: 'mock' } : {},
    { cwd: '/workspace' },
  )

  // Optionally gate the decision domain's durable record writes behind a
  // test barrier: `create` blocks inside the real storage write, mid-save.
  // The facility's unit open is wrapped (not replaced) so every other unit
  // in the harness boots untouched. Both table `put` and `update` funnel
  // into the backend unit's `putRecord`, so gating that one durable call
  // counts and fails exactly the record writes.
  let releasePut = (): void => {}
  let putCalls = 0
  const failFrom = options.failWritesFrom
  const shouldFail = (): boolean =>
    (options.failAfterFirstPut === true && putCalls > 1)
    || (failFrom !== undefined && putCalls >= failFrom)
  if (options.holdFirstPut || failFrom !== undefined) {
    let resolvePut!: () => void
    const gate = new Promise<void>((resolve) => { resolvePut = resolve })
    const storage = ctx.get('storage')
    if (storage === undefined) throw new Error('fixture: storage hub missing')
    const facet = storage.backend.get('json').kv
    if (facet === undefined) throw new Error('fixture: json backend has no kv facet')
    const realOpen = facet.open.bind(facet)
    facet.open = async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
      const unit = await realOpen(descriptor)
      if (descriptor.name !== decisionsDomain.name) return unit
      const realPutRecord = unit.putRecord.bind(unit)
      return {
        loadAll: () => unit.loadAll(),
        putRecord: async (table, key, value) => {
          if (options.holdFirstPut === true) await gate
          putCalls += 1
          if (shouldFail()) throw options.writeFailure ?? new Error('fixture: storage failed')
          return realPutRecord(table, key, value)
        },
        deleteRecord: (table, key) => unit.deleteRecord(table, key),
        setGlobal: value => unit.setGlobal(value),
        close: () => unit.close(),
      }
    }
    releasePut = (): void => { resolvePut() }
  }

  // Hold the real loop behind a pending maintenance job so delivered answers
  // stay durably pending with deterministic timing and no unconfigured LLM
  // turn ever runs; `release()` ends the hold and the loop drains its queue.
  let release = (): void => {}
  if (options.hold) {
    void agent.runMaintenance(signal => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () =>{  resolve() }, { once: true })
      release = () =>{  resolve() }
    }))
  }
  const followup = vi.spyOn(agent, 'followup')

  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: async (
      content: readonly AttachmentAdmissionPart[],
    ): Promise<AdmittedPromptContentPart[]> => {
      const admitted: AdmittedPromptContentPart[] = []
      for (const part of content) {
        if (part.type === 'image') throw new Error('fixture did not configure image persistence')
        admitted.push(part)
      }
      return admitted
    },
  } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)

  const controller = new SessionCommandController(ctx, new ApiSessionAgentController(ctx), '/workspace')
  ctx.provide('sessionController', {
    prompt: (request: SessionPromptRequest) => controller.prompt(request),
  } as never)

  await ctx.plugin(SessionDecisionsService, serviceConfig())
  await ctx.plugin(tools, {})
  const service = ctx.sessionDecisions
  return {
    ctx,
    service,
    agent,
    followup,
    release: () =>{  release() },
    releasePut: () =>{  releasePut() },
    root,
    sessionsRoot,
    controller,
  }
}

/** The correlated answer message of one reservation, as the real queue carries it. */
function answerMessage(requestId: SessionRequestId, text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId: requestId } as never,
  })
}

/** Await the store's async settlement chain until one view matches. */
async function untilSettled(
  service: SessionDecisionsService,
  decisionId: string,
  expected: { answerIndex?: string; lifecycle?: string; hasAnswer?: boolean },
): Promise<void> {
  await vi.waitFor(async () => {
    const view = await service.get(decisionId as never)
    expect(view).toMatchObject(expected)
  }, { timeout: 2_000, interval: 10 })
}

/** Flush the harness session's durable log to the mounted persistence backend. */
async function flushSessions(ctx: Context): Promise<void> {
  const sessions = ctx.get('sessions')
  const session = sessions?.get(SESSION)
  if (sessions !== undefined && session !== undefined) await sessions.flush(session)
}

/** Crash-style copy of a flushed first Host's storage and session-log roots. */
function copyRoots(root: string, sessionsRoot: string): { root: string; sessionsRoot: string } {
  const copy = mkdtempSync(join(tmpdir(), 'session-decisions-cold-'))
  onTestFinished(async () => { await rm(copy, { recursive: true, force: true }) })
  cpSync(root, join(copy, 'storage'), { recursive: true })
  cpSync(sessionsRoot, join(copy, 'sessions'), { recursive: true })
  return { root: join(copy, 'storage'), sessionsRoot: join(copy, 'sessions') }
}

/**
 * Boot a cold Host over (copies of) flushed roots: full storage stack, real
 * JSONL session persistence, loop dependencies, and a decision service whose
 * prompt surface must never fire — cold reconstruction works purely from
 * persisted evidence, never by prompting again.
 */
async function coldHarness(roots: { root: string; sessionsRoot: string }, configOverrides: Partial<SessionDecisionsConfig> = {}): Promise<{
  ctx: Context
  service: SessionDecisionsService
  prompt: Mock<(request: SessionPromptRequest) => Promise<never>>
}> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: roots.root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(SessionPersistenceJsonl, { root: roots.sessionsRoot, compression: 'none' })
  await mountAgentLoopTestDependencies(ctx)
  const prompt = vi.fn((): Promise<never> => Promise.reject(new Error('fixture: cold boot must not prompt')))
  ctx.provide('sessionController', { prompt } as never)
  await ctx.plugin(SessionDecisionsService, serviceConfig(configOverrides))
  const service = ctx.sessionDecisions
  return { ctx, service, prompt }
}

describe('observer input ordering over the real inbox', () => {
  it('settles an accepted answer admitted on durable entry evidence of a real turn', async () => {
    const { service } = await orderingHarness({ realTurn: true, script: [textChunks('done')] })
    const view = await service.create({ sessionId: SESSION, question: 'Pick one', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    expect(await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).toMatchObject({ outcome: 'accepted' })

    // The real loop wakes, claims the pending answer, and commits the real
    // durable user/message entry; the observers settle it as admitted.
    await untilSettled(service, view.decisionId, { answerIndex: 'admitted', lifecycle: 'answered', hasAnswer: true })
  })

  it('degrades a really claimed answer at its claimed turn end without entry', async () => {
    const { ctx, service } = await orderingHarness({ realTurn: true })
    // Public pre-step barrier: the real claim commits, then the step is
    // rejected, so the turn ends without a durable entry — the production
    // claim-without-entry window.
    ctx.on('agent/pre-step', () => Promise.resolve({ kind: 'reject' }))
    const view = await service.create({ sessionId: SESSION, question: 'Pick one', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')

    await untilSettled(service, view.decisionId, { answerIndex: 'needs_reconciliation' })
  })

  it('records a real queue absence as withdrawal and keeps the question open', async () => {
    const { service, agent } = await orderingHarness({ hold: true })
    const view = await service.create({ sessionId: SESSION, question: 'Absent?', choices: ['A'] })
    const requestId = answerRequestId(view.decisionId)
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')

    // Unpaired removal: the message leaves the pending queue without entry.
    expect(agent.inbox.remove((agent.inbox.nextTurn[0]!).id)).toBe(true)
    await untilSettled(service, view.decisionId, { answerIndex: 'withdrawn', lifecycle: 'open' })
  })

  it('supersedes the open question on ordinary composer input, but not correlated delivery', async () => {
    const { service, agent } = await orderingHarness({ hold: true })
    const view = await service.create({ sessionId: SESSION, question: 'Superseded?', choices: ['A', 'B'] })

    // Ordinary composer input carries no feature rpcId and supersedes.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'actually never mind' }],
      source: { kind: 'user' } as never,
    }))
    await untilSettled(service, view.decisionId, { lifecycle: 'superseded' })

    // A correlated answer delivery never supersedes its own question.
    const other = await service.create({ sessionId: SESSION, question: 'Correlated?', choices: ['A', 'B'] })
    const requestId = answerRequestId(other.decisionId)
    expect((await service.submit(other.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
    await untilSettled(service, other.decisionId, { lifecycle: 'open', answerIndex: 'submitting' })
  })

  it('supersedes an accepted pending question, then admits the late real entry without resurrection', async () => {
    const { service, agent, release } = await orderingHarness({
      realTurn: true,
      script: [textChunks('got it')],
      hold: true,
    })
    const view = await service.create({ sessionId: SESSION, question: 'Late edge?', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 2 })).outcome).toBe('accepted')

    // Composer input arrives while the answer is pending in the queue.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'changed my mind' }],
      source: { kind: 'user' } as never,
    }))
    await untilSettled(service, view.decisionId, { lifecycle: 'superseded', answerIndex: 'submitting' })

    // Releasing the hold lets the real loop run the queue: the real durable
    // entry still admits the answer, and the question keeps its staleness
    // fact instead of being resurrected as freshly answered.
    release()
    await untilSettled(service, view.decisionId, { answerIndex: 'admitted', lifecycle: 'superseded' })
  })

  it('upgrades a degraded reservation when the correlated answer is really enqueued', async () => {
    const { service, agent, followup } = await orderingHarness({ hold: true })
    const view = await service.create({ sessionId: SESSION, question: 'Degrade?', choices: ['A'] })
    const requestId = answerRequestId(view.decisionId)
    // Bare rejection before enqueue: degraded to needs_reconciliation,
    // nothing pending.
    followup.mockImplementationOnce(() => {
      throw new Error('fixture: prompt refused before enqueue')
    })
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('reconciliation_required')
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'needs_reconciliation' })

    // The real correlated answer arrives in the real pending queue.
    agent.followup(answerMessage(requestId, `Answer to question ${view.decisionId}: option 1`))
    await untilSettled(service, view.decisionId, { answerIndex: 'submitting' })
  })

  it('closes a refused creation whose save raced ordinary input at the durable put', async () => {
    const { service, agent, releasePut } = await orderingHarness({ hold: true, holdFirstPut: true })
    const creating = service.create({ sessionId: SESSION, question: 'Raced?', choices: ['A'] })
    // Let the create reach the gated durable put, then race it with real
    // ordinary input: the splice bumps the observed generation, and the
    // record has no unresolved index yet, so nothing else supersedes it.
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'raced you' }],
      source: { kind: 'user' } as never,
    }))
    releasePut()
    await expect(creating).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })

    // The refused record is closed, never an actionable open question.
    await vi.waitFor(async () => {
      const views = await service.catalog(SESSION)
      expect(views.length).toBeGreaterThan(0)
      expect(views.every(view => view.lifecycle === 'superseded')).toBe(true)
    }, { timeout: 2_000, interval: 10 })
  })

  it.each([new Error('medium failed'), 'medium failed'])('closes feature admission when neither refused-create closure can write: %s', async (error) => {
    const { service, agent, releasePut } = await orderingHarness({
      hold: true, holdFirstPut: true, failAfterFirstPut: true, writeFailure: error,
    })
    const uncertainty = vi.spyOn(DecisionStore.prototype, 'markNeedsReconciliation').mockRejectedValueOnce(error)
    onTestFinished(() => { uncertainty.mockRestore() })
    const creating = service.create({ sessionId: SESSION, question: 'Raced?', choices: ['A'] })
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'raced you' }],
      source: { kind: 'user' } as never,
    }))
    releasePut()
    await expect(creating).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })

    // The durable closure failed (fixture storage failure on the supersede
    // write), so the saved record stays open — but feature admission is
    // closed: the stale answer can never be admitted to superseded context.
    await vi.waitFor(async () => {
      const views = await service.catalog(SESSION)
      expect(views).toHaveLength(1)
      expect(views[0]!.lifecycle).toBe('open')
    }, { timeout: 2_000, interval: 10 })
    const refused = (await service.catalog(SESSION))[0]!
    expect(await service.submit(refused.decisionId, refused.revision, answerRequestId(refused.decisionId), { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required', requestId: answerRequestId(refused.decisionId) })
    expect(await service.admitAnswer(refused.decisionId, refused.revision, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
  })

  it('cold inspection of another session cannot settle a question via a matching request id', async () => {
    // Crash-checkpoint shape: a durable reservation degraded to
    // needs_reconciliation with no pending evidence left in the inbox.
    const { service, followup, root } = await orderingHarness({ hold: true })
    const view = await service.create({ sessionId: SESSION, question: 'Cross?', choices: ['A'] })
    const requestId = answerRequestId(view.decisionId)
    followup.mockImplementationOnce(() => {
      throw new Error('fixture: prompt refused before enqueue')
    })
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('reconciliation_required')
    await untilSettled(service, view.decisionId, { answerIndex: 'needs_reconciliation' })

    // A second context sharing the storage root: another session's agent
    // holds a pending message derived from the SAME request id. Cold
    // inspection of that agent must not touch the other session's record.
    const otherSession = SessionId('ordering-other')
    const otherCtx = new Context()
    onTestFinished(async () => { await otherCtx.fiber.dispose() })
    await otherCtx.plugin(Storage)
    await otherCtx.plugin(StorageJson, { root })
    await otherCtx.plugin(StorageDomain, { backend: 'json' })
    await mountAgentLoopTestDependencies(otherCtx)
    const otherLoop = await mountAgentLoopTestHarness(otherCtx)
    otherCtx.provide('sessionController', {
      prompt: (request: SessionPromptRequest) => new SessionCommandController(otherCtx, new ApiSessionAgentController(otherCtx), '/workspace').prompt(request),
    } as never)
    const other = await otherLoop.create(otherSession, {}, { cwd: '/workspace' })
    let releaseOther = (): void => {}
    void other.runMaintenance(signal => new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { resolve() }, { once: true })
      releaseOther = (): void => { resolve() }
    }))
    other.followup(answerMessage(requestId, `Answer to question ${view.decisionId}: option 1`))
    await new Promise(resolve => setTimeout(resolve, 20))
    await otherCtx.plugin(SessionDecisionsService, serviceConfig())

    // The uncertain reservation stays untouched by the foreign cold
    // inspection, and the asking service's retry still reports reconciliation.
    // ponytail: this construct cannot distinguish the guard's absence — two
    // live stores on one root clobber each other's writes, so a mutant's
    // foreign pending application is not deterministically observable here.
    // The guard's real crash-checkpoint proof belongs to B1.5's cold-restart
    // probes (single-owner storage).
    const otherService = otherCtx.get('sessionDecisions') as SessionDecisionsService
    expect(await otherService.get(view.decisionId as never)).toMatchObject({ answerIndex: 'needs_reconciliation' })
    expect(await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
    releaseOther()
  })

  it('refuses stale producing-step context before saving, including after a cleanup-write failure and restart', async () => {
    let modelCallStarted = false
    let resolveGate!: () => void
    const gate = new Promise<void>((resolve) => { resolveGate = resolve })
    const { ctx, service, agent, root, sessionsRoot } = await orderingHarness({
      sessionsPersistence: true,
      failWritesFrom: 2,
      realTurn: true,
      script: [
        async () => {
          modelCallStarted = true
          await gate
          return toolCallChunks([{ id: 'call-stale', name: 'request_persistent_question', args: { question: 'Stale?', choices: ['A', 'B'] } }])
        },
        textChunks('done'),
        textChunks('handled the new input'),
      ],
    })
    let staleResult: { isError: boolean; text: string } | undefined
    const entries: string[] = []
    ctx.on('session/event', (session, event) => {
      if (session.id !== SESSION) return
      if (event.type === 'user/message') {
        entries.push(event.data.content.map(part => part.type === 'text' ? part.text : '').join(''))
      }      if (event.type !== 'tool/result') return
      const data = event.data
      if (data.message.toolCallId === 'call-stale') {
        staleResult = { isError: data.message.isError === true, text: data.message.content.map(part => part.type === 'text' ? part.text : '').join('') }
      }
    })

    // Turn 1 starts; step/start captures the context generation including
    // the triggering input.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'ask me something' }],
      source: { kind: 'user' } as never,
    }))
    await vi.waitFor(() =>{  expect(modelCallStarted).toBe(true) }, { timeout: 2_000, interval: 10 })

    // New human input lands mid-step, before the question executes.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'actually one thing first' }],
      source: { kind: 'user' } as never,
    }))
    resolveGate()

    // The question tool refuses: the model response answers stale context.
    await vi.waitFor(() =>{  expect(staleResult).toBeDefined() }, { timeout: 2_000, interval: 10 })
    expect(staleResult!.isError).toBe(true)
    expect(staleResult!.text).toContain('New input arrived')

    expect(await service.catalog(SESSION)).toEqual([])
    await flushSessions(ctx)
    if (sessionsRoot === undefined) throw new Error('fixture: missing durable sessions')
    const cold = await coldHarness(copyRoots(root, sessionsRoot))
    expect(await cold.service.catalog(SESSION)).toEqual([])
    expect(cold.prompt).not.toHaveBeenCalled()
    await vi.waitFor(() =>{  expect(entries).toContain('actually one thing first') }, { timeout: 2_000, interval: 10 })
  })

  it('arms the guard inside a real producing turn and denies the sibling tool call', async () => {
    const { ctx, service, agent } = await orderingHarness({
      realTurn: true,
      script: [toolCallChunks([
        { id: 'call-guard', name: 'request_persistent_question', args: { question: 'Guard?', choices: ['A', 'B'] } },
        { id: 'call-read', name: 'read_persistent_question', args: {} },
      ])],
    })
    const results: Array<{ callId: string; isError: boolean; text: string; meta?: unknown }> = []
    ctx.on('session/event', (session, event) => {
      if (session.id !== SESSION || event.type !== 'tool/result') return
      const data = event.data
      results.push({
        callId: data.message.toolCallId,
        isError: data.message.isError === true,
        text: data.message.content.map(part => part.type === 'text' ? part.text : '').join(''),
        meta: data.meta,
      })
    })

    // One real turn: the model asks the question and calls the read tool as
    // a sibling in the same step. The question saves durably, arms the
    // guard, and concludes the turn; the sibling is denied by the guard.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'ask me something' }],
      source: { kind: 'user' } as never,
    }))
    await vi.waitFor(() => {
      expect(results).toHaveLength(2)
    }, { timeout: 2_000, interval: 10 })
    const question = results.find(result => result.callId === 'call-guard')!
    const read = results.find(result => result.callId === 'call-read')!
    expect(question.isError).toBe(false)
    const meta = question.meta as { decisionId: string; revision: number }
    expect(typeof meta.decisionId).toBe('string')
    expect(typeof meta.revision).toBe('number')
    expect(await service.get((question.meta as { decisionId: string }).decisionId as never))
      .toMatchObject({ lifecycle: 'open' })
    expect(read.isError).toBe(true)
    expect(read.text).toContain('persistent question was just asked')
  })

  it('keeps a real queue edit pending: the replacement tracks, the original retry conflicts, the edit admits', async () => {
    const { ctx, service, agent, followup, release, controller } = await orderingHarness({
      realTurn: true,
      script: [textChunks('ok')],
      hold: true,
    })
    const view = await service.create({ sessionId: SESSION, question: 'Pick one', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
    await untilSettled(service, view.decisionId, { answerIndex: 'submitting' })

    // The real public queue edit path keeps the message identity (id and
    // source.rpcId) and replaces only its text.
    const queued = agent.inbox.nextTurn[0]!
    const edit: SessionUpdateQueueRequest = {
      sessionId: SESSION,
      itemId: queued.id,
      action: {
        kind: 'edit',
        content: [{ type: 'text', text: `Answer to question ${view.decisionId}: edited replacement` }],
      },
    }
    expect(await controller.updateQueue(edit)).toEqual({ accepted: true })

    // The answer stays submitting, the replacement is what remains queued,
    // and the original payload now conflicts with no second prompt.
    await untilSettled(service, view.decisionId, { answerIndex: 'submitting' })
    expect(await service.submit(view.decisionId, view.revision, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'rejected', reason: 'DECISION_CONFLICT' })
    expect(followup).toHaveBeenCalledTimes(1)
    expect(agent.inbox.nextTurn[0]!.id).toBe(queued.id)
    expect(JSON.stringify(agent.inbox.nextTurn[0]!.content)).toContain('edited replacement')

    // Releasing the hold lets the real loop enter the edited answer exactly
    // once: one durable user/message with the reserved rpcId, and admission.
    const entries: UserMessage[] = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message') entries.push(event.data)
    })
    release()
    await untilSettled(service, view.decisionId, { answerIndex: 'admitted', lifecycle: 'answered' })
    const correlated = entries.filter(message =>
      message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === requestId)
    expect(correlated).toHaveLength(1)
    expect(JSON.stringify(correlated[0]!.content)).toContain('edited replacement')
  })

  it('keeps the entry honest when the edited answer is dismissed before it enters', async () => {
    const { ctx, service, release, controller, agent } = await orderingHarness({
      realTurn: true,
      script: [textChunks('ok')],
      hold: true,
    })
    const view = await service.create({ sessionId: SESSION, question: 'Pick one', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
    await untilSettled(service, view.decisionId, { answerIndex: 'submitting' })

    const queued = agent.inbox.nextTurn[0]!
    expect(await controller.updateQueue({
      sessionId: SESSION,
      itemId: queued.id,
      action: { kind: 'edit', content: [{ type: 'text', text: `Answer to question ${view.decisionId}: edited too` }] },
    } satisfies SessionUpdateQueueRequest)).toEqual({ accepted: true })
    await untilSettled(service, view.decisionId, { answerIndex: 'submitting' })

    // The user closes tracking while the answer is still queued. Dismissal
    // never cancels the queued human input.
    const current = await service.get(view.decisionId)
    expect((await service.dismiss(view.decisionId, current!.revision)).ok).toBe(true)

    const entries: UserMessage[] = []
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'user/message') entries.push(event.data)
    })
    release()
    // The queued replacement still enters the durable Session log exactly
    // once, and the record never claims the answer was never queued: the
    // closed tracking stays a dismissal with its saved answer pointer, not
    // a withdrawal.
    await vi.waitFor(async () => {
      const correlated = entries.filter(message =>
        message.source.kind === 'user' && 'rpcId' in message.source && message.source.rpcId === requestId)
      expect(correlated).toHaveLength(1)
    }, { timeout: 2_000, interval: 10 })
    expect(await service.get(view.decisionId))
      .toMatchObject({ answerIndex: 'dismissed', hasAnswer: true, lifecycle: 'cancelled' })
  })

  it('closes in-process admission when the steady-state supersede write fails', async () => {
    const { service, agent } = await orderingHarness({ hold: true, failWritesFrom: 2 })
    const view = await service.create({ sessionId: SESSION, question: 'Stale?', choices: ['A', 'B'] })
    // Write 1 is the create put; the supersede after ordinary input is
    // write 2 and fails durably.
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'newer input' }],
      source: { kind: 'user' } as never,
    }))
    const requestId = answerRequestId(view.decisionId)
    // The stale question stays open on disk, and admission closes for this
    // process too: submit reports reconciliation instead of prompting.
    await vi.waitFor(async () => {
      expect(await service.submit(view.decisionId, view.revision, requestId, { choiceOrdinal: 1 }))
        .toMatchObject({ outcome: 'reconciliation_required' })
    }, { timeout: 2_000, interval: 10 })
    expect(await service.get(view.decisionId)).toMatchObject({ lifecycle: 'open' })
  })

  it('supersedes a raced question durably across restart and refuses its submit without prompting', async () => {
    const { ctx, service, agent, releasePut, root, sessionsRoot } = await orderingHarness({
      hold: true,
      holdFirstPut: true,
      failAfterFirstPut: true,
      sessionsPersistence: true,
    })
    const creating = service.create({ sessionId: SESSION, question: 'Raced?', choices: ['A'] })
    await new Promise(resolve => setTimeout(resolve, 20))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'raced you' }],
      source: { kind: 'user' } as never,
    }))
    releasePut()
    await expect(creating).rejects.toMatchObject({ code: 'DECISION_CONFLICT' })
    // The refused record could not be closed durably (fixture write
    // failures); the raced input is in the session log.
    await vi.waitFor(async () => {
      const views = await service.catalog(SESSION)
      expect(views).toHaveLength(1)
      expect(views[0]!.lifecycle).toBe('open')
    }, { timeout: 2_000, interval: 10 })
    await flushSessions(ctx)
    // Same-root cold boot requires the first Host gone first: single-owner
    // storage (dispose is idempotent, so the harness teardown is a no-op).
    await ctx.fiber.dispose()

    // A new Host over the same flushed roots. Boot reconciliation
    // reads the durable post-anchor ordinary input and closes the stale
    // question — the hole the old process-local refusedAdmissions left.
    const { service: cold, prompt } = await coldHarness({ root, sessionsRoot: sessionsRoot! })
    await vi.waitFor(async () => {
      const views = await cold.catalog(SESSION)
      expect(views).toHaveLength(1)
      expect(views[0]!.lifecycle).toBe('superseded')
    }, { timeout: 2_000, interval: 10 })
    const stale = (await cold.catalog(SESSION))[0]!
    expect(await cold.submit(stale.decisionId, stale.revision, answerRequestId(stale.decisionId), { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'rejected', reason: 'DECISION_TRACKING_CLOSED' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('reconstructs an admission whose index write failed from the durable session evidence', async () => {
    const { ctx, service, release, root, sessionsRoot } = await orderingHarness({
      realTurn: true,
      script: [textChunks('ok')],
      hold: true,
      sessionsPersistence: true,
      failWritesFrom: 3,
    })
    const view = await service.create({ sessionId: SESSION, question: 'Pick one', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    // Write 1 (create put) and write 2 (reserve update) succeed; the
    // observers' admission write after the real entry is write 3 and fails,
    // so the index stays `submitting` on disk while the Session log holds
    // the durable answer entry.
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
    const entered = new Promise<void>((resolve) => {
      ctx.on('session/event', (_session, event) => {
        if (event.type !== 'user/message') return
        const source = event.data.source
        if (source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId) resolve()
      })
    })
    release()
    await entered
    await flushSessions(ctx)
    expect(await service.get(view.decisionId)).toMatchObject({ answerIndex: 'submitting' })

    // A cold Host over copies of the flushed roots reconstructs the
    // admission from the durable entry: admitted, no second prompt.
    const { service: cold, prompt } = await coldHarness(copyRoots(root, sessionsRoot!))
    await untilSettled(cold, view.decisionId, { answerIndex: 'admitted', lifecycle: 'answered' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('keeps an uncertain reservation unknown across restart when no durable entry exists', async () => {
    const { ctx, service, root, sessionsRoot } = await orderingHarness({ hold: true, sessionsPersistence: true })
    const view = await service.create({ sessionId: SESSION, question: 'Unknown?', choices: ['A', 'B'] })
    const requestId = answerRequestId(view.decisionId)
    // The answer is queued but the held loop never runs it: no durable
    // entry exists. Teardown degrades the reservation durably.
    expect((await service.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 })).outcome).toBe('accepted')
    await flushSessions(ctx)

    // The cold Host finds no post-anchor entry evidence and preserves the
    // unknown: the question stays open with needs_reconciliation, never
    // claimed as admitted, and a retry stays honest without prompting.
    const { service: cold, prompt } = await coldHarness(copyRoots(root, sessionsRoot!))
    await untilSettled(cold, view.decisionId, { answerIndex: 'needs_reconciliation', lifecycle: 'open' })
    expect(await cold.submit(view.decisionId, 0, requestId, { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('keeps an unchanged anchored open question answerable across restart', async () => {
    const { ctx, service, root, sessionsRoot } = await orderingHarness({ hold: true, sessionsPersistence: true })
    const view = await service.create({ sessionId: SESSION, question: 'Still open?', choices: ['A', 'B'] })
    await flushSessions(ctx)

    // A complete post-anchor scan without ordinary evidence proves context
    // currency: the question stays open and answerable — admission is not
    // refused, so the retry reaches the real prompt surface exactly once.
    const { service: cold, prompt } = await coldHarness(copyRoots(root, sessionsRoot!))
    await untilSettled(cold, view.decisionId, { lifecycle: 'open', answerIndex: 'none' })
    expect(await cold.submit(view.decisionId, view.revision, answerRequestId(view.decisionId), { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('refuses an open question when the boot scan hits the event budget before the log end', async () => {
    const { ctx, service, agent, root, sessionsRoot } = await orderingHarness({ hold: true, sessionsPersistence: true })
    const first = await service.create({ sessionId: SESSION, question: 'First?', choices: ['A', 'B'] })
    // 300 ordinary queued inputs after the first anchor: durable post-anchor
    // evidence whose first splice supersedes the open question.
    for (let i = 0; i < 300; i++) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: `input ${i}` }],
        source: { kind: 'user' } as never,
      }))
    }
    await untilSettled(service, first.decisionId, { lifecycle: 'superseded' })
    // A second question anchored after all that input.
    const second = await service.create({ sessionId: SESSION, question: 'Second?', choices: ['A', 'B'] })
    await flushSessions(ctx)

    // The boot scan covers only the first 100 events after the earliest
    // anchor, so the second question's context currency is unproven: its
    // admission refuses while the record stays open and cancellable.
    const { service: cold, prompt } = await coldHarness(copyRoots(root, sessionsRoot!), { reconcileMaxEvents: 100 })
    await untilSettled(cold, second.decisionId, { lifecycle: 'open', answerIndex: 'none' })
    expect(await cold.submit(second.decisionId, second.revision, answerRequestId(second.decisionId), { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required' })
    expect(prompt).not.toHaveBeenCalled()
    // Evidence found within the scanned range still settles durably.
    expect(await cold.get(first.decisionId)).toMatchObject({ lifecycle: 'superseded' })
  })

  it('refuses an open question created without a context anchor across restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'session-decisions-noanchor-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const roots = { root, sessionsRoot: join(root, 'sessions') }
    // A cold Host has no live session for the asking session, so the created
    // record carries no context anchor.
    const first = await coldHarness(roots)
    const view = await first.service.create({ sessionId: SESSION, question: 'No anchor?', choices: ['A', 'B'] })
    await first.ctx.fiber.dispose()

    // A restart cannot prove the question's context currency from durable
    // evidence: admission refuses (fail closed) while the record stays open,
    // never falsely superseded and never answered.
    const { service: cold, prompt } = await coldHarness(roots)
    await untilSettled(cold, view.decisionId, { lifecycle: 'open', answerIndex: 'none' })
    expect(await cold.submit(view.decisionId, view.revision, answerRequestId(view.decisionId), { choiceOrdinal: 1 }))
      .toMatchObject({ outcome: 'reconciliation_required', requestId: answerRequestId(view.decisionId) })
    expect(prompt).not.toHaveBeenCalled()
  })
})
