import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as tui from '@deepseek-ai/dsh-tui'
import * as tuiInvariant from '@deepseek-ai/dsh-tui/invariant'
import { describe, expect, it } from 'vitest'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(InvariantRegistry).await()
  const fiber = ctx.plugin(tuiInvariant)
  await fiber.await()
  return { ctx, fiber }
}

describe('tui package lifecycle invariant', () => {
  it('is empty when no controller is mounted', async () => {
    const test = await bench()
    await expect(test.fiber.dispose()).resolves.toBeUndefined()
    expect(tui.name).toBe('tui')
    expect(tuiInvariant.name).toBe('tui-invariant')
    await test.ctx.fiber.dispose()
  })

  it('accepts one provider-backed controller publication and matching disposal', async () => {
    const test = await bench()
    const controller = {} as tui.TuiControllerLifecycle['controller']
    const relation = { controller, agent: undefined, providersPublished: true }
    expect(() => { test.ctx.emit('tui/controller-mounted', relation) }).not.toThrow()
    expect(() => { test.ctx.emit('tui/controller-disposed', relation) }).not.toThrow()
    await test.ctx.fiber.dispose()
  })

  it('fails duplicate live ownership and mismatched disposal', async () => {
    const duplicate = await bench()
    const first = { controller: {} as never, agent: undefined, providersPublished: true }
    duplicate.ctx.emit('tui/controller-mounted', first)
    expect(() => { duplicate.ctx.emit('tui/controller-mounted', first) }).toThrow(/more than one/)
    await duplicate.ctx.fiber.dispose()

    const mismatch = await bench()
    mismatch.ctx.emit('tui/controller-mounted', first)
    expect(() => {
      mismatch.ctx.emit('tui/controller-disposed', { ...first, controller: {} as never })
    }).toThrow(/does not match/)
    await mismatch.ctx.fiber.dispose()
  })

  it('rejects unpublished providers, unregistered Agents, absent owners, and changed disposal relations', async () => {
    const unpublished = await bench()
    expect(() => { unpublished.ctx.emit('tui/controller-mounted', {
      controller: {} as never, agent: undefined, providersPublished: false,
    }) }).toThrow(/interaction providers/)
    await unpublished.ctx.fiber.dispose()

    const unregistered = await bench()
    const agent = { id: SessionId('missing') } as Agent
    expect(() => { unregistered.ctx.emit('tui/controller-mounted', {
      controller: {} as never, agent, providersPublished: true,
    }) }).toThrow(/exact live registry entry/)
    await unregistered.ctx.fiber.dispose()

    const absent = await bench()
    expect(() => { absent.ctx.emit('tui/controller-disposed', {
      controller: {} as never, agent: undefined, providersPublished: true,
    }) }).toThrow(/does not match/)
    await absent.ctx.fiber.dispose()

    const changed = await bench()
    const relation = { controller: {} as never, agent: undefined, providersPublished: true }
    changed.ctx.emit('tui/controller-mounted', relation)
    expect(() => { changed.ctx.emit('tui/controller-disposed', {
      ...relation, providersPublished: false,
    }) }).toThrow(/changed its Agent or provider/)
    await changed.ctx.fiber.dispose()
  })
})
