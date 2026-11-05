/** The real Session listEntries Remote derives navigation from the immutable header. */
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { WorkspaceEntries } from '@deepseek-ai/dsh-host-workspace-entries'
import type { WorkspaceEntriesListRequest, WorkspaceEntriesListing } from '@deepseek-ai/dsh-host-workspace-entries'
import { createSessionTestRemote, testSessionPersistence } from './test-remote.ts'
class Entries extends WorkspaceEntries {
  override async list(request: WorkspaceEntriesListRequest): Promise<WorkspaceEntriesListing> {
    return { root: request.root, path: request.path ?? request.root, entries: [], truncated: false }
  }
}
it('preserves original navigation across an effective-directory change', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'entries-origin-')))
  const ctx = new Context()
  try {
    await mkdir(join(root, 'checkout'))
    const agent = await createDirectoryFixtureAgent(ctx, SessionId('entries-origin'), root)
    await ctx.plugin(Entries)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, { list: () => Promise.resolve([]) }) as never)
    const remote = createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'test', model: 'test' }), cwd: root })
    await ctx.workingDirectory.set(agent, join(root, 'checkout'))
    expect(await remote.listEntries({ sessionId: agent.id })).toMatchObject({ ok: true, value: { root } })
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
