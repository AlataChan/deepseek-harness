import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
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
})
