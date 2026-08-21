import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as tui from '@deepseek-ai/dsh-tui'
import * as tuiInvariant from '@deepseek-ai/dsh-tui/invariant'
import { describe, expect, it } from 'vitest'

describe('tui package lifecycle', () => {
  it('mounts and disposes the package plugin and invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry).await()

    const tuiFiber = ctx.plugin(tui)
    const invariantFiber = ctx.plugin(tuiInvariant)
    await expect(tuiFiber.await()).resolves.toBeDefined()
    await expect(invariantFiber.await()).resolves.toBeDefined()

    await invariantFiber.dispose()
    await tuiFiber.dispose()
    expect(tui.name).toBe('tui')
    expect(tuiInvariant.name).toBe('tui-invariant')
  })
})
