/** The Host marker remains inert until its bundle composition explicitly loads owners. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import * as Marker from '../src/index.ts'
it('loads a valid Host marker without creating a checkout or another service', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(Marker)
    expect(ctx.get('worktrees')).toBeUndefined()
    expect(ctx.get('forgePanel')).toBeUndefined()
    expect(Marker.name).toBe('worktree-review')
  } finally { await ctx.fiber.dispose() }
})
