/** Model dispatch creates a real local Git checkout without changing project identity. */
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Worktrees from '@deepseek-ai/dsh-experimental-worktree'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as WorktreeTool from '../src/index.ts'
const execute = promisify(execFile)
it('records a real create_worktree call and admits the resulting directory on the next request', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'worktree-tool-')))
  const ctx = new Context()
  const git = async (...args: string[]) => await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '', GIT_CONFIG_COUNT: '0' },
  })
  try {
    await git('init', '-b', 'main')
    await writeFile(join(root, 'file.txt'), 'initial\n')
    await git('add', 'file.txt')
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
    const agent = await createDirectoryFixtureAgent(ctx, SessionId('worktree-model'), root, { provider: 'mock', model: 'mock' })
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(LocalSandbox)
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
    await ctx.plugin(Worktrees)
    await ctx.plugin(WorktreeTool)
    expect(ctx.tools.get('create_worktree')?.presentCall?.({ name: 'local-model' })).toEqual({
      card: 'generic', title: 'create_worktree', rawInput: { name: 'local-model' },
    })
    const detached = await ctx.tools.execute({ name: 'create_worktree', arguments: {}, signal: new AbortController().signal, callId: ToolCallId('no-worktree-owner') })
    expect(detached.isError).toBe(true)
    expect(JSON.stringify(detached)).toContain('requires a calling agent')
    const adapter = new MockAdapter([toolCallResponse('create-local', 'create_worktree', { name: 'local-model' }), textResponse('ready')])
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.on('llm/stream', (request, next) => {
      expect(request.messages).toEqual(Session.create(agent.id, agent.session.snapshotEvents(), agent.session.header).deriveMessages())
      return next()
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a local worktree.' }] }))
    await agent.whenIdle()
    const directory = ctx.workingDirectory.get(agent.session)
    expect(adapter.requests).toHaveLength(2)
    expect(directory).toBe(join(root, '.agents', 'worktrees', 'local-model'))
    expect(agent.session.header.cwd).toBe(root)
    expect((await git('worktree', 'list', '--porcelain')).stdout).toContain(directory)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain(directory)
    expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')?.data.reason.kind).toBe('completed')
    expect(ctx.sandboxPolicy.resolve({ session: agent.session }).workspaceRoot).toBe(root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
