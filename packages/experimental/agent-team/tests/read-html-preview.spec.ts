/** Host coverage for Archify HTML preview reads. */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setupWithCwd() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-team-html-'))
  roots.push(cwd)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-store-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
  const lead = await ctx.agentLoop.create(
    SessionId('lead-html'),
    { provider: 'mock', model: 'mock' },
    { cwd },
  )
  return { ctx, lead, cwd }
}

describe('readHtmlPreview', () => {
  it('reads an html file under the Lead cwd', async () => {
    const { ctx, lead, cwd } = await setupWithCwd()
    const file = join(cwd, 'pipeline.html')
    writeFileSync(file, '<!doctype html><title>team</title>', 'utf8')
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'pipeline.html' }))
      .resolves.toMatchObject({ path: file, html: expect.stringContaining('<title>team</title>') })
  })

  it('rejects empty, non-html, missing, and oversized paths and reads .htm', async () => {
    const { ctx, lead, cwd } = await setupWithCwd()
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: '   ' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'notes.txt' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'missing.html' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
    writeFileSync(join(cwd, 'ok.htm'), '<html></html>', 'utf8')
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'ok.htm' }))
      .resolves.toMatchObject({ html: '<html></html>' })
    writeFileSync(join(cwd, 'big.html'), 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8')
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'big.html' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
  })

  it('rejects a relative path when the Lead has no cwd', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-store-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(TestSessionQuery)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(SubagentFork, { providerName: 'fork' })
    await ctx.plugin(TeamService)
    ctx.llm.registerAdapter(['mock'], new MockAdapter([]))
    const lead = await ctx.agentLoop.create(SessionId('lead-html-nocwd'), { provider: 'mock', model: 'mock' })
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: 'pipeline.html' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
    const loose = join(mkdtempSync(join(tmpdir(), 'dsh-team-html-loose-')), 'loose.html')
    roots.push(loose.slice(0, loose.lastIndexOf('/')))
    writeFileSync(loose, '<html>loose</html>', 'utf8')
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: loose }))
      .resolves.toMatchObject({ path: loose, html: '<html>loose</html>' })
  })

  it('rejects paths outside the Lead cwd', async () => {
    const { ctx, lead, cwd } = await setupWithCwd()
    const outside = join(cwd, '..', `escape-${Date.now()}.html`)
    writeFileSync(outside, '<html></html>', 'utf8')
    roots.push(outside)
    await expect(ctx.agentTeams.remoteReadHtmlPreview(lead, { path: outside }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TARGET' })
  })
})
