/**
 * One desktop-operation Agent owns the MCP server.
 * The shared preset registration does not spawn it, and a second Agent cannot
 * take the desktop until the first Agent is disposed.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { bindDesktopAgents } from '../src/index.ts'
import { acquireDesktopLease, DesktopLeaseBusyError } from '../src/lease.ts'
import type { DesktopMcpLaunch } from '../src/preset.ts'

const supported = process.platform === 'darwin' && process.arch === 'arm64'
const supervisor = fileURLToPath(new URL('../src/supervisor.ts', import.meta.url))
const fixture = fileURLToPath(new URL('./fixtures/mcp-server.ts', import.meta.url))
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('desktop-operation agent lease', () => {
  it('does not spawn for an unsupported host or for an Agent on another preset', async () => {
    const idle = new Context()
    contexts.push(idle)
    bindDesktopAgents(idle, undefined)
    await idle.serial('agent/created', {
      agent: { ctx: new Context() } as Agent,
      source: 'startup',
    })
    const dir = await mkdtemp(join(tmpdir(), 'ad01-other-preset-'))
    const ctx = await world()
    bindDesktopAgents(ctx, fixtureLaunch(dir))
    await ctx.agentPresets.register({ id: 'standard', name: 'standard', listed: true, plugins: [] })
    await ctx.serial('agent/created', {
      agent: { ctx: new Context() } as Agent,
      source: 'startup',
    })
    await expect(stat(join(dir, 'agent-desktop.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(dir, { recursive: true, force: true })
  })

  it('starts the fixture only after an Agent selects the preset, then refuses the next Agent until disposal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-agent-lease-'))
    const lock = join(dir, 'agent-desktop.lock')
    const ctx = await world()
    try {
      bindDesktopAgents(ctx, fixtureLaunch(dir, 60_000))
      await ctx.agentPresets.register({ id: 'desktop-operation', name: '桌面操作', listed: true, plugins: [] })
      await ctx.agentPresets.register({ id: 'standard', name: 'standard', listed: true, plugins: [] })
      const idle = await acquireDesktopLease(lock)
      await idle.release()
      const plainDir = await mkdtemp(join(tmpdir(), 'ad01-agent-lease-plain-'))
      const plain = await world()
      try {
        bindDesktopAgents(plain, fixtureLaunch(plainDir))
        await plain.agentPresets.register({ id: 'desktop-operation', name: '桌面操作', listed: true, plugins: [] })
        await plain.agentPresets.register({ id: 'standard', name: 'standard', listed: true, plugins: [] })
        if (!supported) {
          await expect(openAgent(plain, 'plain', 'desktop-operation')).rejects.toThrow(/initial connection/)
        } else {
          const handle = await openAgent(plain, 'plain', 'desktop-operation')
          expect(tool(handle.agent, 'mcp__agent-desktop__hold')).toBeDefined()
          await handle.dispose()
        }
      } finally {
        await rm(plainDir, { recursive: true, force: true })
      }
      if (!supported) {
        await expect(openAgent(ctx, 'linux-desktop', 'desktop-operation')).rejects.toThrow(/initial connection/)
        return
      }
      const first = await openAgent(ctx, 'first', 'desktop-operation')
      expect(tool(first.agent, 'mcp__agent-desktop__hold')).toBeDefined()
      const other = await openAgent(ctx, 'other', 'standard')
      expect(tool(other.agent, 'mcp__agent-desktop__hold')).toBeUndefined()
      await expect(openAgent(ctx, 'second', 'desktop-operation')).rejects.toThrow(/initial connection/)
      await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      await first.dispose()
      const third = await openAgent(ctx, 'third', 'desktop-operation')
      expect(tool(third.agent, 'mcp__agent-desktop__hold')).toBeDefined()
      await third.dispose()
      await other.dispose()
      const released = await acquireDesktopLease(lock)
      await released.release()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('drops a client whose startup fails and does not keep that fiber', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-registrar-fail-'))
    const ctx = await world()
    try {
      const launch = { ...fixtureLaunch(dir), args: ['-e', 'process.exit(1)'] }
      bindDesktopAgents(ctx, launch)
      await ctx.agentPresets.register({ id: 'desktop-operation', name: '桌面操作', listed: true, plugins: [] })
      await expect(openAgent(ctx, 'bad', 'desktop-operation')).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('disposes a client that is still starting when the registrar unloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-registrar-inflight-'))
    const lock = join(dir, 'agent-desktop.lock')
    const held = join(dir, 'held')
    const ctx = await world()
    try {
      const launch = supported
        ? fixtureLaunch(dir, undefined, { AD_FIXTURE_START_DELAY_MS: '4000' })
        : hangingLaunch(dir, held)
      await ctx.agentPresets.register({ id: 'desktop-operation', name: '桌面操作', listed: true, plugins: [] })
      const registrar = await ctx.plugin({
        name: 'desktop-operation-registrar-inflight',
        inject: ['agentPresets'],
        apply: (child) => { bindDesktopAgents(child, launch) },
      })
      const creating = openAgent(ctx, 'inflight', 'desktop-operation')
      if (supported) await waitUntilBusy(lock)
      else await waitForFile(held)
      await registrar.dispose()
      if (supported) {
        const released = await acquireDesktopLease(lock)
        await released.release()
      }
      const outcome = await creating.then(
        handle => tool(handle.agent, 'mcp__agent-desktop__hold'),
        () => undefined,
      )
      expect(outcome).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('keeps a replacement registrar client when an older Agent disposes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-registrar-replace-'))
    const lock = join(dir, 'agent-desktop.lock')
    const ctx = await world()
    try {
      const launch = supported ? fixtureLaunch(dir, 60_000) : directFixture(dir)
      await ctx.agentPresets.register({ id: 'desktop-operation', name: '桌面操作', listed: true, plugins: [] })
      const firstRegistrar = await ctx.plugin({
        name: 'desktop-operation-registrar-a',
        inject: ['agentPresets'],
        apply: (child) => { bindDesktopAgents(child, launch) },
      })
      const first = await openAgent(ctx, 'owner-a', 'desktop-operation')
      expect(tool(first.agent, 'mcp__agent-desktop__hold')).toBeDefined()
      if (supported) {
        await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      }
      await firstRegistrar.dispose()
      expect(tool(first.agent, 'mcp__agent-desktop__hold')).toBeUndefined()
      if (supported) {
        const gap = await acquireDesktopLease(lock)
        await gap.release()
      }
      const secondRegistrar = await ctx.plugin({
        name: 'desktop-operation-registrar-b',
        inject: ['agentPresets'],
        apply: (child) => { bindDesktopAgents(child, launch) },
      })
      const second = await openAgent(ctx, 'owner-b', 'desktop-operation')
      expect(tool(second.agent, 'mcp__agent-desktop__hold')).toBeDefined()
      await first.dispose()
      expect(tool(second.agent, 'mcp__agent-desktop__hold')).toBeDefined()
      if (supported) {
        await expect(acquireDesktopLease(lock)).rejects.toThrow('desktop-operation: shared desktop lease is held')
      }
      await secondRegistrar.dispose()
      expect(tool(second.agent, 'mcp__agent-desktop__hold')).toBeUndefined()
      if (supported) {
        const released = await acquireDesktopLease(lock)
        await released.release()
      }
      await second.dispose()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

async function world(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'standard' })
  return ctx
}

function openAgent(ctx: Context, id: string, presetId: string) {
  return ctx.agents.create({
    sessionId: SessionId(id),
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, presetId) },
  })
}

function tool(agent: Agent, name: string) {
  return agent.ctx.tools.get(name, scopeOf(agent.ctx))
}

function fixtureLaunch(dir: string, toolCallTimeoutMs?: number, extraEnv?: Record<string, string>): DesktopMcpLaunch {
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: process.execPath,
    args: ['--import', 'tsx/esm', supervisor, '--lock', join(dir, 'agent-desktop.lock'), '--binary', process.execPath, '--', '--import', 'tsx/esm', fixture],
    env: {
      AGENT_DESKTOP_HOME: dir,
      AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper'),
      ...extraEnv,
    },
    cwd: '',
    ...toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs },
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

function directFixture(dir: string): DesktopMcpLaunch {
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: process.execPath,
    args: ['--import', 'tsx/esm', fixture],
    env: {
      AGENT_DESKTOP_HOME: dir,
      AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper'),
    },
    cwd: '',
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

function hangingLaunch(dir: string, held: string): DesktopMcpLaunch {
  return {
    transport: 'stdio',
    serverName: 'agent-desktop',
    command: process.execPath,
    args: ['-e', 'require("node:fs").writeFileSync(process.env.AD_HOLD_FILE, "up"); setInterval(() => {}, 1000)'],
    env: {
      AGENT_DESKTOP_HOME: dir,
      AGENT_DESKTOP_MACOS_HELPER_PATH: join(dir, 'helper'),
      AD_HOLD_FILE: held,
    },
    cwd: '',
    failOnStartupError: true,
    reconnect: { enabled: false },
  }
}

async function waitUntilBusy(lock: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const lease = await acquireDesktopLease(lock)
      await lease.release()
    } catch (error: unknown) {
      if (error instanceof DesktopLeaseBusyError) return
      throw error
    }
    await new Promise((resolve) => { setTimeout(resolve, 15) })
  }
  throw new Error('desktop-operation: fixture did not take the lock')
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      await stat(path)
      return
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        await new Promise((resolve) => { setTimeout(resolve, 15) })
        continue
      }
      throw error
    }
  }
  throw new Error('desktop-operation: held file did not appear')
}
