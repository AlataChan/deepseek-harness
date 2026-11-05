/** Execution changes do not retarget project file navigation. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { listEntries } from '../src/list-entries.ts'
it('lists the original project after entering its worktree', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'worktree-navigation-')))
  const ctx = new Context()
  try {
    const checkout = join(root, 'checkout')
    await mkdir(checkout)
    await writeFile(join(root, 'original.txt'), 'original')
    await writeFile(join(checkout, 'checkout.txt'), 'checkout')
    const agent = await createDirectoryFixtureAgent(ctx, SessionId('file-navigation'), root)
    await ctx.workingDirectory.set(agent, checkout)
    expect(ctx.workingDirectory.get(agent.session)).toBe(checkout)
    const listing = await listEntries({ root: agent.session.header.cwd! })
    expect(listing.entries.map(entry => entry.name)).toContain('original.txt')
    expect(listing.entries.map(entry => entry.name)).not.toContain('checkout.txt')
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
