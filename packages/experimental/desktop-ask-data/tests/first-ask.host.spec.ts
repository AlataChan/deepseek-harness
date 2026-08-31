/** Isolated first-ask smoke against seeded data-agent 0.1.3. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createSessionTestRemote } from '../../../api/session-controller/tests/test-remote.ts'
import DesktopAskData from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const seedScript = join(repoRoot, 'scripts/seed-desktop-profile-plugin.mjs')

let home: string | undefined

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

describe('first-ask against data-agent 0.1.3', () => {
  it('imports the sample, commits, queries 渠道, and refuses a write', { timeout: 180_000 }, async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-ask-data-first-'))
    const profileDir = join(home, 'profiles', 'desktop')
    execFileSync(process.execPath, [seedScript, 'seed', '--profile-dir', profileDir], {
      cwd: repoRoot,
      env: { ...process.env, DSH_HOME: home },
      stdio: 'pipe',
    })
    expect(existsSync(join(
      profileDir,
      'node_modules/@yejiming/dsh-data-agent/lib/index.js',
    ))).toBe(true)
    const dataAgent = await import('@yejiming/dsh-data-agent') as unknown as {
      inject: string[]
      apply: (ctx: Context, config: Record<string, unknown>) => Promise<void>
      Config: never
    }

    const cwd = await mkdtemp(join(tmpdir(), 'dsh-ask-data-cwd-'))
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    ctx.provide('agentPresets', {
      resolve: (id?: string) => Promise.resolve({ id: id ?? 'data-agent', trust: 'system', path: '/p' }),
      mount: async () => ({ id: 'data-agent' }),
      admitSelect: () => () => {},
      standingKeyFor: async () => 'data-agent',
    })
    ctx.provide('commands', { register: () => () => {} })
    ctx.provide('credentials', { resolve: async () => undefined })
    ctx.provide('llm', { listProviders: () => [] })
    ctx.provide('tools', { register: () => () => {}, list: () => [] })
    ctx.provide('systemPrompt', {
      section: () => () => {},
    })

    const factory: AgentFactory = {
      async createAgent(_owner, options) {
        const session = ctx.sessions.prepare(
          options.sessionId,
          options.meta === undefined ? {} : { meta: options.meta },
        )
        const detach = ctx.sessions.enter(session)
        ctx.sessions.announce(session)
        const agent = stubAgent(session)
        const agentCtx = ctx.extend({ agent })
        ;(agent as { ctx?: Context }).ctx = agentCtx
        await options.setup?.(agentCtx)
        const unregister = ctx.agents.register(agent)
        return {
          agent,
          dispose: () => {
            unregister()
            detach()
            return Promise.resolve()
          },
        }
      },
      async resume() {
        throw new Error('first-ask has no persisted sessions')
      },
    }
    ctx.agents.setFactory(factory)

    await ctx.plugin({
      name: 'data-agent',
      inject: dataAgent.inject,
      Config: dataAgent.Config,
      apply: dataAgent.apply,
    }, { persistConnections: false, installPreset: false })
    await ctx.plugin(DesktopAskData, { dataHome: join(home, 'data-sources') })

    const remote = createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd,
    })
    const imported = await remote.importAskDataSample()
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    const committed = await remote.commitAskData({ sourceId: imported.value.source.id })
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const connections = ctx.get('dataAgentConnections') as {
      query(sessionId: string, sql: string, signal: AbortSignal): Promise<{ exitCode: number | null; stdout: string }>
      executeInteractive(
        sessionId: string,
        sql: string,
        signal: AbortSignal,
      ): Promise<{ kind: string; rows?: unknown[] }>
      resolveForExecution(sessionId: string): Promise<{ database: string; readonly?: boolean }>
    }
    const signal = new AbortController().signal
    const resolved = await connections.resolveForExecution(committed.value.sessionId)
    expect(resolved.readonly).toBe(true)
    const queried = await connections.executeInteractive(
      committed.value.sessionId,
      'SELECT 渠道 FROM 销售明细 LIMIT 1',
      signal,
    )
    expect(queried.kind).toBe('table')
    expect(queried.rows?.length).toBeGreaterThan(0)
    await expect(connections.query(
      committed.value.sessionId,
      "INSERT INTO 销售明细 VALUES ('x','x','x','1','1')",
      signal,
    )).rejects.toThrow(/只读/)
    await ctx.fiber.dispose()
  })
})
