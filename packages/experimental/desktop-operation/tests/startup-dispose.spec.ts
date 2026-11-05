/**
 * Current mcp-client against the supervisor and a fixture child.
 * Runs on darwin arm64, where the supervisor CLI is willing to spawn.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply as applyMcp } from '@deepseek-ai/dsh-mcp-client'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { acquireDesktopLease } from '../src/lease.ts'
import { startSupervisor } from '../src/supervisor.ts'

const supported = process.platform === 'darwin' && process.arch === 'arm64'
const supervisor = fileURLToPath(new URL('../src/supervisor.ts', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/mcp-server.ts', import.meta.url))

describe.skipIf(!supported)('desktop-operation startup and dispose', () => {
  it('discovers the fixture, keeps the lock across cancel, and releases it on dispose', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-startup-'))
    const lock = join(dir, 'agent-desktop.lock')
    const ready = join(dir, 'ready')
    const ctx = new Context()
    let open = true
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await applyMcp(ctx, mcpConfig(dir, lock, ready, process.execPath, ['--import', 'tsx/esm', fixture]))
      expect(ctx.tools.get('mcp__agent-desktop__hold')).toBeDefined()
      const controller = new AbortController()
      const pending = ctx.tools.execute({
        name: 'mcp__agent-desktop__hold',
        arguments: {},
        callId: ToolCallId('hold'),
        signal: controller.signal,
      })
      await waitFor(ready)
      await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      controller.abort()
      expect((await pending).isError).toBe(true)
      await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      await ctx.fiber.dispose()
      open = false
      const lease = await acquireDesktopLease(lock)
      await lease.release()
    } finally {
      if (open) await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('drops SIGTERM and SIGINT listeners when the child exits and when stop settles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-signals-'))
    const term = process.listenerCount('SIGTERM')
    const intr = process.listenerCount('SIGINT')
    try {
      const held = await startSupervisor({
        platform: 'darwin',
        arch: 'arm64',
        home: dir,
        lockPath: join(dir, 'held.lock'),
        binary: process.execPath,
        helper: join(dir, 'helper'),
        args: ['-e', 'setInterval(() => {}, 1e9)'],
        stdio: 'ignore',
        signals: true,
      })
      expect(process.listenerCount('SIGTERM')).toBe(term + 1)
      expect(process.listenerCount('SIGINT')).toBe(intr + 1)
      await held.stop()
      expect(process.listenerCount('SIGTERM')).toBe(term)
      expect(process.listenerCount('SIGINT')).toBe(intr)
      const finished = await startSupervisor({
        platform: 'darwin',
        arch: 'arm64',
        home: dir,
        lockPath: join(dir, 'exit.lock'),
        binary: process.execPath,
        helper: join(dir, 'helper'),
        args: ['-e', 'process.exit(0)'],
        stdio: 'ignore',
        signals: true,
      })
      expect(await finished.exited).toBe(0)
      expect(process.listenerCount('SIGTERM')).toBe(term)
      expect(process.listenerCount('SIGINT')).toBe(intr)
    } finally {
      expect(process.listenerCount('SIGTERM')).toBe(term)
      expect(process.listenerCount('SIGINT')).toBe(intr)
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects a missing binary and leaves the lock file without a held descriptor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-missing-'))
    const lock = join(dir, 'agent-desktop.lock')
    const ctx = new Context()
    let open = true
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await expect(applyMcp(ctx, mcpConfig(dir, lock, join(dir, 'unused'), join(dir, 'missing-binary'), ['mcp']))).rejects.toThrow(/initial connection/)
      await ctx.fiber.dispose()
      open = false
      expect((await stat(lock)).isFile()).toBe(true)
      const lease = await acquireDesktopLease(lock)
      await lease.release()
    } finally {
      if (open) await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function mcpConfig(dir: string, lock: string, ready: string, binary: string, childArgs: readonly string[]): Config {
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: process.execPath,
    args: ['--import', 'tsx/esm', supervisor, '--lock', lock, '--binary', binary, '--', ...childArgs],
    env: {
      AGENT_DESKTOP_HOME: dir,
      AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper'),
      AD_FIXTURE_READY: ready,
    },
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await readFile(path)
      return
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        await new Promise((resolve) => { setTimeout(resolve, 20) })
        continue
      }
      throw error
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}
