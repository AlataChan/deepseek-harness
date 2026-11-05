/** Host-owned retained checkout survives cold Session reconstruction and missing-directory repair. */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { expect, it } from 'vitest'
import { git, harness, repository, testAgent } from './harness.ts'
it('restores recorded checkout identity without moving the effective directory', async () => {
  const root = await repository()
  const ctx = await harness(root)
  try {
    const agent = await testAgent(ctx, root)
    const created = await ctx.worktrees.create(agent, { name: 'host-retained' })
    await ctx.plugin(JsonlPersistence, { root: join(root, 'logs'), compression: 'none' })
    const stored = await ctx.sessionPersistence.create(agent.session.header)
    await stored.append(agent.session.snapshotEvents())
    await stored.close()
    const reader = await ctx.sessionPersistence.open(agent.id, 'read')
    const log = await reader.read()
    const restored = Session.create(SessionId('host-restored'), log.events, { ...reader.header, id: SessionId('host-restored') })
    await reader.close()
    expect(ctx.workingDirectory.get(restored)).toBe(created.path)
    expect(restored.header.cwd).toBe(root)
    await ctx.workingDirectory.set(agent, root)
    await rm(created.path, { recursive: true })
    await ctx.worktrees.restore(agent, created)
    expect(ctx.workingDirectory.get(agent.session)).toBe(root)
    expect(await git(created.path, 'rev-parse', 'HEAD')).toBe(created.baseCommit)
    expect(agent.session.header.cwd).toBe(root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
