import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import AgentRegistry, { Inbox, type Agent, type AgentHandle, type CreateAgentOptions, type ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ReasoningEffortId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createTuiController } from '../src/driver/controller.ts'
import { installTuiModelSelection, ownTuiSession } from '../src/driver/session.ts'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

const displayBudget = { maxBytes: 32_768, maxColumns: 32_768 }

function tuiStore() {
  return createTuiStore(createInitialState({ columns: 80 }))
}

interface Bench {
  ctx: Context
  factoryCalls: Array<CreateAgentOptions | ResumeAgentOptions>
  followups: Array<{ message: UserMessage; published: boolean }>
  disposeCalls: string[]
  cancelCalls: string[]
  idleCalls: string[]
  resumed: Map<string, readonly SessionEvent[]>
  controls: { skipSetup: boolean; resumeBarrier: Promise<void> | undefined }
  query: {
    listSessions: () => Promise<SessionRecord[]>
    readTitleSnapshots: () => Promise<SessionTitleObservationResult[]>
  }
}

async function bench(loaderSettlement: Promise<void> = Promise.resolve()): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(ApprovalService, {})
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'default-provider', model: 'default-model' })
  const query = {
    listSessions: () => Promise.resolve([] as SessionRecord[]),
    readTitleSnapshots: () => Promise.resolve([] as SessionTitleObservationResult[]),
  }
  ctx.provide('sessionQuery', query as never)
  ctx.provide('loader', { await: () => loaderSettlement } as never)
  const factoryCalls: Array<CreateAgentOptions | ResumeAgentOptions> = []
  const followups: Array<{ message: UserMessage; published: boolean }> = []
  const disposeCalls: string[] = []
  const cancelCalls: string[] = []
  const idleCalls: string[] = []
  const resumed = new Map<string, readonly SessionEvent[]>()
  const controls = { skipSetup: false, resumeBarrier: undefined as Promise<void> | undefined }

  async function make(
    ownerCtx: Context,
    session: Session,
    options: CreateAgentOptions | ResumeAgentOptions,
  ): Promise<AgentHandle> {
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: 'agentOptions' in options ? options.agentOptions ?? {} : {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: () => { cancelCalls.push(session.id) },
      whenIdle: () => { idleCalls.push(session.id); return Promise.resolve() },
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        followups.push({ message, published: ctx.agents.get(session.id) === agent })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
      steer: () => {},
      inject: () => {},
    } satisfies Partial<Agent>)
    if (!controls.skipSetup) await options.setup?.(agentCtx)
    const disposeRegistration = ctx.agents.register(agent)
    return {
      agent,
      dispose: async () => {
        disposeCalls.push(session.id)
        disposeRegistration()
        await agentCtx.fiber.dispose()
      },
    }
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx, options) {
      factoryCalls.push(options)
      return make(ownerCtx, ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      }), options)
    },
    async resume(ownerCtx, options) {
      factoryCalls.push(options)
      await controls.resumeBarrier
      const events = resumed.get(options.resumeSessionId)
      if (events === undefined) throw new Error(`session ${options.resumeSessionId} not found`)
      return make(ownerCtx, ctx.sessions.create(options.resumeSessionId, { seed: events }), options)
    },
  })
  return { ctx, factoryCalls, followups, disposeCalls, cancelCalls, idleCalls, resumed, controls, query }
}

describe('tui session controller', () => {
  it('waits for Loader settlement, creates with cwd/default model, and publishes before the initial task', async () => {
    const settled = Promise.withResolvers<undefined>()
    const test = await bench(settled.promise)
    const pending = createTuiController(test.ctx, {
      startup: { kind: 'fresh', task: 'do the work' },
      cwd: '/workspace',
      displayBudget,
      sessionSelectorLimit: 50,
      resumeTranscriptRows: 200,
      createSessionId: () => SessionId('fresh-session'),
      store: tuiStore(),
    })
    await Promise.resolve()
    expect(test.factoryCalls).toHaveLength(0)
    settled.resolve(undefined)
    const controller = await pending

    const created = test.factoryCalls[0]
    expect(created).toMatchObject({
      sessionId: 'fresh-session',
      meta: { cwd: '/workspace' },
      agentOptions: { provider: 'default-provider', model: 'default-model' },
    })
    expect(typeof created?.setup).toBe('function')
    expect(controller.modelSelection?.current).toEqual({
      provider: 'default-provider', model: 'default-model',
    })
    if (controller.modelSelection === undefined) throw new Error('model selection missing')
    controller.modelSelection.current = { provider: 'picked', model: 'picked-model' }
    expect(controller.modelSelection.current).toEqual({ provider: 'picked', model: 'picked-model' })
    expect(test.followups).toEqual([expect.objectContaining({ published: true })])
    expect(test.followups[0]?.message.content).toEqual([{ type: 'text', text: 'do the work' }])
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })

  it('restores logged model selection and ignores events from another session', async () => {
    const test = await bench()
    const id = SessionId('resume-session')
    test.resumed.set(id, [{
      type: 'request/header',
      seq: 0,
      time: 1,
      data: {
        reason: 'initial',
        header: { config: {
          provider: 'logged-provider', model: 'logged-model', reasoningEffort: ReasoningEffortId('high'),
        } },
      },
    }])
    test.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'resume', sessionId: id },
      cwd: '/workspace', displayBudget, sessionSelectorLimit: 50,
      resumeTranscriptRows: 200,
      store: tuiStore(),
    })
    expect(controller.modelSelection?.current).toEqual({
      provider: 'logged-provider', model: 'logged-model', reasoningEffort: 'high',
    })

    const before = controller.transcript.rows.length
    const foreign = test.ctx.sessions.create(SessionId('foreign'))
    foreign.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'foreign' }],
    }), { surfaceOp: 'append' })
    expect(controller.transcript.rows).toHaveLength(before)

    controller.agent?.session.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'owned' }],
    }), { surfaceOp: 'append' })
    expect(controller.transcript.rows.at(-1)).toEqual(expect.objectContaining({ text: 'owned' }))
    await controller.dispose()
    expect(test.disposeCalls).toEqual([id])
    await test.ctx.fiber.dispose()
  })

  it('restores a logged model selection without optional reasoning effort', async () => {
    const test = await bench()
    const id = SessionId('resume-without-effort')
    test.resumed.set(id, [{
      type: 'request/header', seq: 0, time: 1,
      data: { reason: 'initial', header: { config: { provider: 'logged', model: 'plain' } } },
    }])
    test.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'resume', sessionId: id }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })
    expect(controller.modelSelection?.current).toEqual({ provider: 'logged', model: 'plain' })
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })

  it('owns the interaction providers and settles them during controller disposal', async () => {
    const test = await bench()
    const store = tuiStore()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, createSessionId: () => SessionId('interaction-session'), store,
      resumeTranscriptRows: 200,
    })
    const agent = controller.agent
    if (agent === undefined) throw new Error('fresh controller did not publish its Agent')
    const pending = test.ctx.userQuestions.ask({
      agent,
      questions: [{ id: 'confirm', question: 'Proceed?' }],
    })
    await Promise.resolve()
    expect(store.getSnapshot().interaction?.kind).toBe('question')

    await controller.dispose()
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(store.getSnapshot().interaction).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('rejects model-selection setup without a scoped Agent and supports default ownership observers', async () => {
    const empty = new Context()
    expect(() => installTuiModelSelection(empty, {
      provider: 'default-provider', model: 'default-model',
    })).toThrow(/no scoped Agent/)
    await empty.fiber.dispose()

    const test = await bench()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200,
      createSessionId: () => SessionId('owned-defaults'), store: tuiStore(),
    })
    const agent = controller.agent
    const selection = controller.modelSelection
    if (agent === undefined || selection === undefined) throw new Error('owned values missing')
    const dispose = vi.fn(async () => {})
    const owned = ownTuiSession({ agent, dispose }, selection, displayBudget)
    expect(owned.transcript).toBeDefined()
    agent.ctx.emit('agent/status', { agent, status: 'running' })
    agent.ctx.emit('agent/status', { agent: { id: SessionId('foreign') } as Agent, status: 'idle' })
    await owned.dispose()
    await owned.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })

  it('supports the resume picker, selection cancellation, and empty-controller operations', async () => {
    const test = await bench()
    const id = SessionId('picker-session')
    test.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'resume-picker' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })
    expect(controller.agent).toBeUndefined()
    expect(controller.modelSelection).toBeUndefined()
    expect(controller.transcript.rows).toEqual([])
    expect(controller.selectorRows).toHaveLength(1)
    expect(() => { controller.submit('message') }).toThrow(/no active Agent/)
    controller.cancelActive()
    controller.settleInteractions()
    await controller.whenIdle()
    await controller.flush()
    await expect(controller.selectSession(SessionId('unknown'))).rejects.toThrow(/not found in the selector/)
    await controller.selectSession(undefined as never)
    controller.cancelSelection()
    expect(controller.selectionCancelled).toBe(true)
    controller.cancelSelection()
    await controller.dispose()
    await controller.dispose()
    controller.cancelSelection()
    await expect(controller.selectSession(id)).rejects.toThrow(/disposed/)
    await expect(controller.openResumeSelector()).rejects.toThrow(/disposed/)
    await test.ctx.fiber.dispose()
  })

  it('opens, guards, cancels, and switches the resume selector', async () => {
    const test = await bench()
    const first = SessionId('first-session')
    const second = SessionId('second-session')
    test.resumed.set(second, [])
    test.query.listSessions = () => Promise.resolve([
      { header: { version: 0, id: first, createdAt: 2, cwd: '/one' }, live: false, persisted: true },
      { header: { version: 0, id: second, createdAt: 1, cwd: '/two' }, live: false, persisted: true },
    ])
    const store = tuiStore()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200,
      createSessionId: () => first, store,
    })
    controller.submit('')
    controller.submit('next')
    controller.cancelActive()
    await controller.whenIdle()
    await controller.flush()
    expect(test.cancelCalls).toEqual([first])
    expect(test.idleCalls).toEqual([first])

    Object.assign(controller.agent!, { status: 'running' })
    await expect(controller.openResumeSelector()).rejects.toThrow(/turn or interaction/)
    Object.assign(controller.agent!, { status: 'idle' })
    store.dispatch({ type: 'interaction/approval', id: 99 as never, toolName: 'bash' })
    await expect(controller.openResumeSelector()).rejects.toThrow(/turn or interaction/)
    store.dispatch({ type: 'interaction/settled', id: 99 as never })

    await controller.openResumeSelector()
    expect(controller.selectorRows).toHaveLength(2)
    await controller.selectSession(first)
    expect(store.getSnapshot().overlay.kind).toBe('none')
    await controller.openResumeSelector()
    await controller.selectSession(second)
    expect(controller.agent?.id).toBe(second)
    expect(test.disposeCalls).toContain(first)

    test.ctx.provide('sessionQuery', undefined)
    await expect(controller.openResumeSelector()).rejects.toThrow(/service was disposed/)
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })

  it('settles approval and question interactions without granting them', async () => {
    const test = await bench()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200,
      createSessionId: () => SessionId('settle-session'), store: tuiStore(),
    })
    const agent = controller.agent!
    agent.session.append('turn/start', { turn: 1 })
    const approval = test.ctx.approval.request({ agent, toolName: 'bash' })
    await Promise.resolve()
    controller.settleInteractions()
    await expect(approval).resolves.toBe('cancelled')
    const question = test.ctx.userQuestions.ask({
      agent, questions: [{ id: 'one', question: 'One?' }],
    })
    await Promise.resolve()
    controller.settleInteractions()
    await expect(question).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })

  it('retains only configured resume rows and disposes a resume completed after shutdown', async () => {
    const test = await bench()
    const id = SessionId('long-session')
    const donor = test.ctx.sessions.create(SessionId('retention-donor'))
    for (const text of ['one', 'two', 'three']) donor.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text }],
    }), { surfaceOp: 'append' })
    test.resumed.set(id, [...donor.events])
    test.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const store = tuiStore()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'resume', sessionId: id }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 1, store,
    })
    expect(controller.transcript.rows).toHaveLength(3)
    expect(store.getSnapshot().projection?.rows).toEqual([
      expect.objectContaining({ kind: 'status', text: '2 earlier transcript rows omitted' }),
      expect.objectContaining({ kind: 'message', text: 'three' }),
    ])
    await controller.dispose()

    const late = await bench()
    const lateId = SessionId('late-session')
    late.resumed.set(lateId, [])
    late.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id: lateId, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const picker = await createTuiController(late.ctx, {
      startup: { kind: 'resume-picker' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })
    const gate = Promise.withResolvers<undefined>()
    late.controls.resumeBarrier = gate.promise
    const selecting = picker.selectSession(lateId)
    await Promise.resolve()
    await picker.dispose()
    gate.resolve(undefined)
    await selecting
    expect(late.disposeCalls).toEqual([lateId])
    await late.ctx.fiber.dispose()
    await test.ctx.fiber.dispose()
  })

  it('fails loud for missing services, missing sessions, and factories that skip setup', async () => {
    const empty = new Context()
    await expect(createTuiController(empty, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })).rejects.toThrow(/required Agent/)
    await empty.fiber.dispose()

    const missing = await bench()
    await expect(createTuiController(missing.ctx, {
      startup: { kind: 'resume', sessionId: SessionId('missing') }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })).rejects.toThrow(/not found/)
    await missing.ctx.fiber.dispose()

    const fresh = await bench()
    fresh.controls.skipSetup = true
    await expect(createTuiController(fresh.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200,
      createSessionId: () => SessionId('bad-fresh'), store: tuiStore(),
    })).rejects.toThrow(/create setup/)
    expect(fresh.disposeCalls).toEqual(['bad-fresh'])
    await fresh.ctx.fiber.dispose()

    const resumed = await bench()
    const id = SessionId('bad-resume')
    resumed.controls.skipSetup = true
    resumed.resumed.set(id, [])
    resumed.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    await expect(createTuiController(resumed.ctx, {
      startup: { kind: 'resume', sessionId: id }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })).rejects.toThrow(/resume setup/)
    expect(resumed.disposeCalls).toEqual([id])
    await resumed.ctx.fiber.dispose()
  })

  it('mints a session id when no deterministic factory is supplied', async () => {
    const test = await bench()
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'fresh' }, cwd: '/workspace', displayBudget,
      sessionSelectorLimit: 50, resumeTranscriptRows: 200, store: tuiStore(),
    })
    expect(controller.agent?.id).toMatch(/^session-/u)
    await controller.dispose()
    await test.ctx.fiber.dispose()
  })
})
