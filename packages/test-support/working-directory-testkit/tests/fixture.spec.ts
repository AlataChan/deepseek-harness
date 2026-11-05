import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountDirectoryFixture } from '../src/index.ts'
it('mounts a real owner explicitly and preserves the existing filesystem on reuse', async () => {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    expect(ctx.get('workingDirectory')).toBeUndefined()
    await mountDirectoryFixture(ctx, process.cwd())
    const fs = ctx.fs
    await mountDirectoryFixture(ctx, process.cwd())
    expect(ctx.fs.processPath(await ctx.fs.resolve('.'))).toBe(fs.processPath(await fs.resolve('.')))
    const driver = await mountAgentLoopTestHarness(ctx)
    const agent = await driver.create(SessionId('directory-fixture'), {}, { cwd: process.cwd() })
    expect(await ctx.workingDirectory.ensure(agent)).toBe(process.cwd())
  } finally { await ctx.fiber.dispose() }
})
