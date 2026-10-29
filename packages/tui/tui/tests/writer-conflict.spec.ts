import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { TerminalRenderer } from '../src/render.ts'
import { SessionAdapter } from '../src/session.ts'
import { getLocale } from '../src/locales.ts'
import { createTestAgent, createTestSession } from './fixtures.ts'

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const HOLDER = fileURLToPath(new URL('../../../session/session-persistence-jsonl/tests/fixtures/lease-holder.mjs', import.meta.url))

describe('TUI Writer Conflict & Session Lock Contention', () => {
  it('excludes a second TUI writer while the first process holds the session lock, and recovers when released', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-lock-'))
    dirs.push(root)
    const sessionId = 'tui-conflict-session'

    // Process 1: Real holder child process creating session and holding the write lock
    const holder = spawn(process.execPath, [HOLDER, root, sessionId], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    const exited = new Promise<void>((resolve) => {
      holder.once('exit', () => { resolve() })
    })

    await once(holder.stdout, 'data') // 'holding\n'

    // Process 2: TUI SessionAdapter in current process
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(AgentRegistry)

    const renderer = new TerminalRenderer(100)
    const dict = getLocale('zh')

    const mockAgent = createTestAgent({
      id: sessionId,
      session: createTestSession(sessionId),
    })

    ctx.agents.setFactory({
      createAgent: async (_ownerCtx, options) => {
        await ctx.sessionPersistence.open(options.sessionId, 'write')
        return { agent: mockAgent, dispose: async () => {} }
      },
      resume: async (_ownerCtx, options) => {
        await ctx.sessionPersistence.open(options.resumeSessionId, 'write')
        return { agent: mockAgent, dispose: async () => {} }
      },
    })

    const adapter = new SessionAdapter(ctx, renderer, {
      onStatusChange: () => {},
      onModelChange: () => {},
      onSessionChange: () => {},
      onRenderRequest: () => {},
    }, dict)

    // Attempting to open the contested session reports conflict without crashing
    await adapter.resumeSession(SessionId(sessionId))
    const lines = renderer.getLines()
    expect(lines.some(l => l.text.includes(dict.sessionConflictError))).toBe(true)

    // Terminate holder: kernel immediately releases the write lock with the descriptors
    holder.kill('SIGKILL')
    await exited

    // Now resume succeeds because the lock is available
    renderer.clear()
    await adapter.resumeSession(SessionId(sessionId))
    const resumedLines = renderer.getLines()
    expect(resumedLines.some(l => l.text.includes(dict.sessionResumed))).toBe(true)
  })
})
