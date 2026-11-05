/** Actual file mutations follow execution cwd while observations and sandbox origin remain intact. */
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as ObservationPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { expect, it } from 'vitest'
import * as FsTools from '../src/index.ts'
it('reads, observes, edits, patches, writes, and recovers in the selected directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fs-directory-')))
  const selected = join(root, 'selected')
  await mkdir(selected)
  await writeFile(join(root, 'same.txt'), 'original\n')
  await writeFile(join(selected, 'same.txt'), 'selected\n')
  const ctx = new Context()
  try {
    const agent = await createDirectoryFixtureAgent(ctx, SessionId('fs-directory'), root)
    await ctx.plugin(ObservationPolicy)
    await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root })
    await ctx.plugin(FsTools, { applyPatch: true })
    let sequence = 0
    const call = (name: string, args: object, signal = new AbortController().signal) => ctx.tools.execute({
      name, arguments: args, agent, signal, callId: ToolCallId(`fs-directory-${++sequence}`),
    })
    expect((await call('read', { file_path: 'same.txt' })).isError).toBe(false)
    await ctx.workingDirectory.set(agent, selected)
    const unobserved = await call('edit', { file_path: 'same.txt', old_string: 'selected', new_string: 'wrong' })
    expect(unobserved.isError).toBe(true)
    expect(JSON.stringify(unobserved)).toContain('FS_NOT_OBSERVED')
    const read = await call('read', { file_path: 'same.txt' })
    expect(JSON.stringify(read)).toContain('selected')
    expect((await call('edit', { file_path: 'same.txt', old_string: 'selected', new_string: 'edited' })).isError).toBe(false)
    expect((await call('apply_patch', { input: '*** Begin Patch\n*** Update File: same.txt\n@@\n-edited\n+patched\n*** End Patch' })).isError).toBe(false)
    expect((await call('write', { file_path: 'new.txt', content: 'new\n' })).isError).toBe(false)
    expect(await readFile(join(selected, 'same.txt'), 'utf8')).toBe('patched\n')
    expect(await readFile(join(root, 'same.txt'), 'utf8')).toBe('original\n')
    expect(ctx.sandboxPolicy.resolve({ session: agent.session }).workspaceRoot).toBe(root)
    const aborted = new AbortController()
    aborted.abort()
    expect((await call('write', { file_path: 'cancelled.txt', content: 'cancelled' }, aborted.signal)).isError).toBe(true)
    await rm(selected, { recursive: true })
    expect(JSON.stringify(await call('read', { file_path: 'same.txt' }))).toContain('original')
    expect(ctx.workingDirectory.get(agent.session)).toBe(root)
    expect(agent.session.header.cwd).toBe(root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
