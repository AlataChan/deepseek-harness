import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry, { Inbox, type Agent, type AgentHandle, type CreateAgentOptions, type ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createTuiController } from '../src/driver/controller.ts'

const displayBudget = { maxBytes: 32_768, maxColumns: 32_768 }

interface Bench {
  ctx: Context
  factoryCalls: Array<CreateAgentOptions | ResumeAgentOptions>
  followups: Array<{ message: UserMessage; published: boolean }>
  disposeCalls: string[]
  resumed: Map<string, readonly SessionEvent[]>
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
  const resumed = new Map<string, readonly SessionEvent[]>()

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
      cancel: () => {},
      whenIdle: () => Promise.resolve(),
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        followups.push({ message, published: ctx.agents.get(session.id) === agent })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
      steer: () => {},
      inject: () => {},
    } satisfies Partial<Agent>)
    await options.setup?.(agentCtx)
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
      const events = resumed.get(options.resumeSessionId)
      if (events === undefined) throw new Error(`session ${options.resumeSessionId} not found`)
      return make(ownerCtx, ctx.sessions.create(options.resumeSessionId, { seed: events }), options)
    },
  })
  return { ctx, factoryCalls, followups, disposeCalls, resumed, query }
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
      createSessionId: () => SessionId('fresh-session'),
    })
    await Promise.resolve()
    expect(test.factoryCalls).toHaveLength(0)
    settled.resolve(undefined)
    const controller = await pending

    expect(test.factoryCalls[0]).toMatchObject({
      sessionId: 'fresh-session',
      meta: { cwd: '/workspace' },
      agentOptions: { provider: 'default-provider', model: 'default-model' },
      setup: expect.any(Function),
    })
    expect(controller.modelSelection?.current).toEqual({
      provider: 'default-provider', model: 'default-model',
    })
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
        header: { config: { provider: 'logged-provider', model: 'logged-model' } },
      },
    }])
    test.query.listSessions = () => Promise.resolve([{
      header: { version: 0, id, createdAt: 1, cwd: '/workspace' }, live: false, persisted: true,
    }])
    const controller = await createTuiController(test.ctx, {
      startup: { kind: 'resume', sessionId: id },
      cwd: '/workspace', displayBudget, sessionSelectorLimit: 50,
    })
    expect(controller.modelSelection?.current).toEqual({
      provider: 'logged-provider', model: 'logged-model',
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
})
