/**
 * Offline stdio initialize and tools/list against the pinned binary.
 * `AD01_NATIVE_ROOT` points at the read-only preflight `release` directory.
 * `AD01_REQUIRE_NATIVE=1` fails when that directory is missing; otherwise the suite skips.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyMcp } from '@deepseek-ai/dsh-mcp-client'
import type { Config } from '@deepseek-ai/dsh-mcp-client'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { acquireDesktopLease } from '../src/lease.ts'

const nativeRoot = process.env.AD01_NATIVE_ROOT
const required = process.env.AD01_REQUIRE_NATIVE === '1'
const enabled = nativeRoot !== undefined && nativeRoot !== ''
if (required && !enabled) throw new Error('AD01_NATIVE_ROOT is required')

const supervisor = fileURLToPath(new URL('../src/supervisor.ts', import.meta.url))
const prefix = 'mcp__agent-desktop__'

describe.skipIf(!enabled)('pinned agent-desktop MCP', () => {
  it('initializes and lists tools offline, then releases the lock', async () => {
    const root = nativeRoot ?? ''
    const dir = await mkdtemp(join(tmpdir(), 'ad01-native-'))
    const home = join(dir, 'state')
    const lock = join(dir, 'agent-desktop.lock')
    const ctx = new Context()
    let open = true
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await applyMcp(ctx, mcpConfig(home, lock, join(root, 'agent-desktop'), join(root, 'agent-desktop-macos-helper')))
      const names = ctx.tools.schemas().map(row => row.name).filter(name => name.startsWith(prefix)).map(name => name.slice(prefix.length))
      expect(names).toHaveLength(67)
      expect(names[0]).toBe('desktop_snapshot')
      expect(names[66]).toBe('desktop_trace_export')
      const recorded = JSON.parse(await readFile(join(root, '..', 'mcp-preflight.json'), 'utf8')) as { tools?: { name?: string }[] }
      expect(names).toEqual((recorded.tools ?? []).map(tool => tool.name))
      await ctx.fiber.dispose()
      open = false
      const lease = await acquireDesktopLease(lock)
      await lease.release()
    } finally {
      if (open) await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the lock when the supervisor is killed and the pinned child is still alive', async () => {
    const root = nativeRoot ?? ''
    const dir = await mkdtemp(join(tmpdir(), 'ad01-retain-'))
    const home = join(dir, 'state')
    const lock = join(dir, 'agent-desktop.lock')
    const child = spawn(process.execPath, [
      '--import', 'tsx/esm', supervisor,
      '--lock', lock,
      '--binary', join(root, 'agent-desktop'),
      '--', 'mcp',
    ], {
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        AGENT_DESKTOP_HOME: home,
        AGENT_DESKTOP_MACOS_HELPER_PATH: join(root, 'agent-desktop-macos-helper'),
      },
    })
    let nativePid: number | undefined
    try {
      if (child.pid === undefined) throw new Error('supervisor pid is missing')
      nativePid = await waitForChild(child.pid)
      process.kill(child.pid, 'SIGKILL')
      await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      process.kill(nativePid, 'SIGKILL')
      await waitUntilGone(nativePid)
      const lease = await acquireDesktopLease(lock)
      await lease.release()
    } finally {
      await releaseSupervisor(child, nativePid)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function mcpConfig(home: string, lock: string, binary: string, helper: string): Config {
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: process.execPath,
    args: ['--import', 'tsx/esm', supervisor, '--lock', lock, '--binary', binary, '--', 'mcp'],
    env: {
      AGENT_DESKTOP_HOME: home,
      AGENT_DESKTOP_MACOS_HELPER_PATH: helper,
    },
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

function childPids(parent: number): Promise<number[]> {
  return new Promise((resolve, reject) => {
    execFile('pgrep', ['-P', String(parent)], (error, stdout) => {
      if (error !== null && error.code === 1) { resolve([]); return }
      if (error !== null) { reject(error instanceof Error ? error : new Error(error.message, { cause: error })); return }
      resolve(stdout.split('\n').map(line => Number(line)).filter(pid => Number.isInteger(pid) && pid > 0))
    })
  })
}

async function waitForChild(parent: number): Promise<number> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const pids = await childPids(parent)
    const first = pids[0]
    if (first !== undefined) return first
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
  throw new Error('pinned child did not appear')
}

async function waitUntilGone(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
  throw new Error(`pid ${String(pid)} stayed alive`)
}

async function releaseSupervisor(child: ChildProcess, nativePid: number | undefined): Promise<void> {
  if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    try {
      child.kill('SIGTERM')
    } catch (error: unknown) {
      if (!isGone(error)) throw error
    }
  }
  await waitForSupervisor(child)
  if (nativePid === undefined) return
  if (pidAlive(nativePid)) {
    try {
      process.kill(nativePid, 'SIGKILL')
    } catch (error: unknown) {
      if (!isGone(error)) throw error
    }
  }
  await waitUntilGone(nativePid)
}

function waitForSupervisor(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('supervisor did not exit')) }, 5_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (isGone(error)) return false
    throw error
  }
}

function isGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}
