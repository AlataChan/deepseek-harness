/** Local-only Git repositories and real runtime services for the Changes Remote. */
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mountDirectoryFixture, createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Worktrees, { type Config as WorktreeConfig } from '@deepseek-ai/dsh-experimental-worktree'
import { SessionId } from '@deepseek-ai/dsh-session'
const execute = promisify(execFile)
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], {
    cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_PARAMETERS: '', GIT_CONFIG_COUNT: '0' },
  })
  return result.stdout.trim()
}
export async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'local-review-')))
  await git(root, 'init', '-b', 'main')
  await git(root, 'config', 'user.name', 'Local fixture')
  await git(root, 'config', 'user.email', 'local@example.invalid')
  await writeFile(join(root, 'tracked.txt'), 'initial\n')
  await git(root, 'add', 'tracked.txt'); await git(root, 'commit', '-m', 'fixture')
  return root
}
export async function harness(root: string, config: WorktreeConfig = {}, worktrees = true): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountDirectoryFixture(ctx, root)
  await ctx.plugin(LocalSubprocess); await ctx.plugin(LocalSandbox)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', workspaceRoot: root })
  if (worktrees) await ctx.plugin(Worktrees, config)
  await mountAgentLoopTestHarness(ctx)
  return ctx
}
export async function testAgent(ctx: Context, root: string) {
  return await createDirectoryFixtureAgent(ctx, SessionId('local-diff'), root)
}
