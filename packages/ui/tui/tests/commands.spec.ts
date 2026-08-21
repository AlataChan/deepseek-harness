import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { createTuiCommandRouter } from '../src/driver/commands.ts'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

async function bench(status: 'idle' | 'running' = 'idle') {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('command-session'))
  const agent = {
    id: session.id, options: {}, session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status, ctx: ctx.extend(), cancel: vi.fn(), whenIdle: vi.fn(async () => {}),
    runMaintenance: vi.fn(), send: vi.fn(), followup: vi.fn(), steer: vi.fn(), inject: vi.fn(),
  } as unknown as Agent
  const unregister = ctx.agents.register(agent)
  const store = createTuiStore(createInitialState({ columns: 80 }))
  const submitModel = vi.fn()
  const openResume = vi.fn(async () => {})
  const requestShutdown = vi.fn(async () => {})
  const router = createTuiCommandRouter(ctx, {
    agent: () => agent, store, submitModel, openResume, requestShutdown,
  })
  return { ctx, agent, session, store, submitModel, openResume, requestShutdown, router, unregister }
}

describe('tui command routing', () => {
  it('executes a registered command with the exact Agent and abort signal and logs its result', async () => {
    const test = await bench()
    const handler = vi.fn(async (invocation: { agent: Agent; signal: AbortSignal }) => {
      expect(invocation.agent).toBe(test.agent)
      return { kind: 'success' as const, text: 'command complete' }
    })
    test.ctx.commands.register({ name: 'inspect', description: 'Inspect the workspace', handler })
    const abort = new AbortController()

    await expect(test.router.route('/inspect target', abort.signal)).resolves.toBe('accepted')
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ signal: abort.signal }))
    expect(test.session.events.slice(-2).map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(test.session.events.at(-1)).toMatchObject({ data: { kind: 'success', text: 'command complete' } })
    await test.ctx.fiber.dispose()
  })

  it('renders effective help and keeps local resume and exit out of the registry', async () => {
    const test = await bench()
    test.ctx.commands.register({
      name: 'inspect', description: 'Inspect the workspace', input: { hint: '<path>' },
      handler: () => ({ kind: 'success' }),
    })

    await test.router.route('/help', new AbortController().signal)
    expect(test.store.getSnapshot().finalizedRows.at(-1)?.text)
      .toContain('/inspect <path> — Inspect the workspace')
    await test.router.route('/resume', new AbortController().signal)
    expect(test.openResume).toHaveBeenCalledOnce()
    await test.router.route('/exit', new AbortController().signal)
    expect(test.requestShutdown).toHaveBeenCalledOnce()
    expect(test.session.events).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('refuses resume during work or a pending interaction', async () => {
    const running = await bench('running')
    await expect(running.router.route('/resume', new AbortController().signal)).resolves.toBe('preserve')
    expect(running.openResume).not.toHaveBeenCalled()
    expect(running.store.getSnapshot().finalizedRows.at(-1)?.text).toContain('while a turn')
    await running.ctx.fiber.dispose()

    const interacting = await bench()
    interacting.store.dispatch({
      type: 'interaction/approval', id: 1 as never, toolName: 'bash',
    })
    await expect(interacting.router.route('/resume', new AbortController().signal)).resolves.toBe('preserve')
    expect(interacting.openResume).not.toHaveBeenCalled()
    await interacting.ctx.fiber.dispose()
  })

  it('requires a second identical submission before an unknown slash line reaches the model', async () => {
    const test = await bench()
    const signal = new AbortController().signal
    await expect(test.router.route('/future value', signal)).resolves.toBe('preserve')
    expect(test.submitModel).not.toHaveBeenCalled()
    expect(test.store.getSnapshot().finalizedRows.at(-1)?.text).toContain('Submit it again')

    await expect(test.router.route('/future value', signal)).resolves.toBe('accepted')
    expect(test.submitModel).toHaveBeenCalledWith('/future value')
    await test.ctx.fiber.dispose()
  })

  it('preserves the command draft when a registered handler fails', async () => {
    const test = await bench()
    test.ctx.commands.register({
      name: 'fail', description: 'Fail', handler: () => { throw new Error('command failed') },
    })
    await expect(test.router.route('/fail', new AbortController().signal)).resolves.toBe('preserve')
    expect(test.store.getSnapshot().finalizedRows.at(-1)).toMatchObject({ kind: 'error', text: 'command failed' })
    await test.ctx.fiber.dispose()
  })
})
