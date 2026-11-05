/** Standing teammates retain the original project after the Lead enters another directory. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Team from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
it('keeps standing seats and HTML preview on header.cwd without creating teammate checkouts', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shared-worktree-team-')))
  const ctx = new Context()
  try {
    const lead = await createDirectoryFixtureAgent(ctx, SessionId('worktree-lead'), root, { provider: 'mock', model: 'mock' })
    ctx.llm.registerAdapter(['mock'], new MockAdapter(Array.from({ length: 10 }, () => textResponse('done'))))
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(Subagents); await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(Team, { institutionCatalogPath: join(root, 'squads.json') })
    const roster = await ctx.agentTeams.remoteEnsureInstitutionSquad(lead, {
      squadId: 'document', seats: [{ name: 'archivist', provider: 'mock', model: 'mock' }],
    })
    const originalSeats = roster.members.filter(member => member.role === 'teammate').map(member => member.id)
    const checkout = join(root, 'checkout'); await mkdir(checkout)
    await writeFile(join(root, 'summary.html'), '<title>original</title>')
    await writeFile(join(checkout, 'summary.html'), '<title>checkout</title>')
    await ctx.workingDirectory.set(lead, checkout)
    const again = await ctx.agentTeams.ensureInstitutionSquad(lead, { squadId: 'document' })
    expect(again.members.filter(member => member.role === 'teammate').map(member => member.id)).toEqual(originalSeats)
    expect(await ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'summary.html' })).toMatchObject({ html: '<title>original</title>' })
    for (const id of originalSeats) {
      await vi.waitFor(async () =>{  expect((await ctx.sessionPersistence.stat(id))?.header.cwd).toBe(root) })
    }
    expect(ctx.get('worktrees')).toBeUndefined()
    expect(lead.session.header.cwd).toBe(root)
    expect(ctx.workingDirectory.get(lead.session)).toBe(checkout)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
