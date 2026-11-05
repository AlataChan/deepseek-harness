import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'

async function fixture() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  ctx.provide('typert', {
    lookups: { configure: () => {} }, contexts: { configureHost: () => {} },
  } as never)
  const agent = await createDirectoryFixtureAgent(ctx, SessionId('reservation'), process.cwd())
  const session = agent.session
  const inbox = agent.inbox
  const followup = vi.spyOn(agent, 'followup').mockImplementation((message) => { inbox.append('next-turn', message) })
  const agents = new ApiSessionAgentController(ctx)
  const resolve = vi.spyOn(agents, 'resolveAgent').mockResolvedValue({ agent })
  const admit = vi.fn(async (content: SessionPromptRequest['content']) => content)
  ctx.provide('attachments', { admitPromptContent: admit } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined, bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
  } as never)
  const controller = new SessionCommandController(ctx, agents, '/workspace')
  const request = (id = 'request'): SessionPromptRequest => ({
    sessionId: session.id, requestId: id as SessionRequestId,
    content: [{ type: 'text', text: '完整的人类回答\nsecond line' }], mode: 'queue',
  })
  return { controller, request, resolve, admit, followup, inbox }
}

describe('prompt request reservation', () => {
  it('reserves before Agent resolution and shares one admission promise', async () => {
    const { controller, request, resolve, followup, inbox } = await fixture()
    const pending = Promise.withResolvers<Awaited<ReturnType<ApiSessionAgentController['resolveAgent']>>>()
    const resolved = await resolve.getMockImplementation()?.(request().sessionId)
    if (resolved === undefined) throw new Error('missing fixture Agent')
    resolve.mockReturnValueOnce(pending.promise)
    const first = controller.prompt(request())
    const second = controller.prompt(request())
    expect(first).toBe(second)
    expect(resolve).not.toHaveBeenCalled()
    pending.resolve(resolved)
    await expect(first).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledOnce()
    expect(inbox.nextTurn).toHaveLength(1)
    await controller.prompt(request())
    expect(inbox.nextTurn).toHaveLength(1)
  })

  it('shares failure and permits a single retry without dropping admitted answers', async () => {
    const { controller, request, admit, followup, inbox } = await fixture()
    const failure = Promise.withResolvers<SessionPromptRequest['content']>()
    admit.mockReturnValueOnce(failure.promise)
    const first = controller.prompt(request())
    const second = controller.prompt(request())
    failure.reject(new Error('attachment unavailable'))
    await expect(first).rejects.toThrow('prompt rejected')
    await expect(second).rejects.toThrow('prompt rejected')
    expect(inbox.nextTurn).toEqual([])
    await controller.prompt(request())
    await controller.prompt(request('other'))
    const accepted = [...inbox.nextTurn]
    await controller.prompt(request())
    expect(inbox.nextTurn).toEqual(accepted)
    expect(followup).toHaveBeenCalledTimes(2)
    expect(inbox.nextTurn[0]?.content).toEqual(request().content)
  })

  it('preserves a queued answer whose requestId already exists', async () => {
    const { controller, request, inbox, admit } = await fixture()
    const value = request()
    const message = createUserMessage({ content: [{ type: 'text', text: 'verbatim human answer' }],
      source: { kind: 'user', rpcId: value.requestId } })
    inbox.append('next-turn', message)
    await expect(controller.prompt(value)).resolves.toEqual({ accepted: true })
    expect(inbox.nextTurn).toEqual([message])
    expect(admit).not.toHaveBeenCalled()
  })
})


it('retains a distinct outstanding reservation after another request settles', async () => {
  const { controller, request, admit, inbox } = await fixture()
  const firstAdmission = Promise.withResolvers<SessionPromptRequest['content']>()
  const secondAdmission = Promise.withResolvers<SessionPromptRequest['content']>()
  admit.mockReturnValueOnce(firstAdmission.promise).mockReturnValueOnce(secondAdmission.promise)
  const firstRequest = request('first')
  const secondRequest = { ...request('second'), content: [{ type: 'text' as const, text: 'second human answer' }] }
  const first = controller.prompt(firstRequest)
  const second = controller.prompt(secondRequest)
  await vi.waitFor(() => { expect(admit).toHaveBeenCalledTimes(2) })
  expect(inbox.nextTurn).toEqual([])
  firstAdmission.resolve(firstRequest.content)
  await expect(first).resolves.toEqual({ accepted: true })
  expect(controller.prompt(secondRequest)).toBe(second)
  expect(inbox.nextTurn.map(message => message.content)).toEqual([firstRequest.content])
  secondAdmission.resolve(secondRequest.content)
  await expect(second).resolves.toEqual({ accepted: true })
  await controller.prompt(firstRequest)
  await controller.prompt(secondRequest)
  expect(inbox.nextTurn.map(message => message.content)).toEqual([firstRequest.content, secondRequest.content])
  expect(admit).toHaveBeenCalledTimes(2)
})
