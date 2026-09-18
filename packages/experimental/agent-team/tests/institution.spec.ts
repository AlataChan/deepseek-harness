import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { TeamError } from '../src/index.ts'
import { INSTITUTION_SQUADS } from '../src/institution.ts'
import { TestSessionQuery } from './test-session-query.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(
  catalogPath: string,
  script: ConstructorParameters<typeof MockAdapter>[0] = [],
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-institution-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService, { institutionCatalogPath: catalogPath })
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const lead = await ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, storageRoot }
}

describe('institution squads', () => {
  it('lists the three baked-in squads before any Lead is bound', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx } = await setup(catalogPath)
    const rows = await ctx.agentTeams.remoteListInstitutionSquads()
    expect(rows.map(row => [row.id, row.displayName, row.established, row.leadSessionId])).toEqual([
      ['document', '文书组', false, undefined],
      ['case', '案例组', false, undefined],
      ['comms', '传播部', false, undefined],
    ])
    expect(rows[0]?.seats.map(seat => seat.name)).toEqual([
      'archivist', 'drafter', 'metric-checker', 'reviewer',
    ])
  })

  it('persists a seat model in the catalog without spawning', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx } = await setup(catalogPath)
    const rows = await ctx.agentTeams.remoteUpdateInstitutionSeat({
      squadId: 'document',
      name: 'drafter',
      provider: 'mock',
      model: 'seat-model',
    })
    expect(rows.find(row => row.id === 'document')?.seats.find(seat => seat.name === 'drafter')).toMatchObject({
      provider: 'mock',
      model: 'seat-model',
    })
    await expect(ctx.agentTeams.remoteUpdateInstitutionSeat({
      squadId: 'document',
      name: 'nobody',
      model: 'x',
    })).rejects.toSatisfy((error: unknown) => error instanceof TeamError && error.code === 'TEAM_INSTITUTION_SEAT_UNKNOWN')
  })

  it('ensures a squad once and reuses the same Lead and names on the second call', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath)
    const first = await ctx.agentTeams.remoteEnsureInstitutionSquad(lead, {
      squadId: 'document',
      seats: [{ name: 'archivist', provider: 'mock', model: 'seat-a' }],
    })
    expect(first.sessionId).toBe(lead.id)
    expect(first.members.filter(member => member.role === 'teammate').map(member => member.name)).toEqual(
      INSTITUTION_SQUADS[0]!.seats.map(seat => seat.name),
    )
    const listed = await ctx.agentTeams.listInstitutionSquads()
    expect(listed.find(row => row.id === 'document')).toMatchObject({
      established: true,
      leadSessionId: lead.id,
    })
    expect(listed.find(row => row.id === 'document')?.seats.find(seat => seat.name === 'archivist')?.model)
      .toBeDefined()
    const second = await ctx.agentTeams.ensureInstitutionSquad(lead, { squadId: 'document' })
    expect(second.members.filter(member => member.role === 'teammate').map(member => member.name)).toEqual(
      first.members.filter(member => member.role === 'teammate').map(member => member.name),
    )
  })

  it('clears a Lead binding when the Session is no longer persisted', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx } = await setup(catalogPath)
    writeFileSync(catalogPath, `${JSON.stringify({
      version: 1,
      leads: { document: 'missing-lead' },
      seats: {},
    }, null, 2)}\n`)
    const rows = await ctx.agentTeams.listInstitutionSquads()
    expect(rows.find(row => row.id === 'document')).toMatchObject({
      established: false,
    })
    expect(rows.find(row => row.id === 'document')?.leadSessionId).toBeUndefined()
  })

  it('refuses institution ensure from a teammate', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath, ['hang'])
    const spawned = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'scratch',
      description: 'scratch',
      prompt: [{ type: 'text', text: 'wait' }],
      context: 'fresh',
      provider: 'spawn',
      signal: new AbortController().signal,
    })
    const child = await vi.waitFor(() => {
      const agent = ctx.agents.get(spawned.member.id)
      expect(agent?.status).toBe('running')
      return agent!
    })
    await expect(ctx.agentTeams.ensureInstitutionSquad(child, { squadId: 'case' })).rejects.toSatisfy(
      (error: unknown) => error instanceof TeamError && error.code === 'TEAM_LEAD_REQUIRED',
    )
    ctx.agentTeams.interrupt(lead, 'scratch')
    await vi.waitFor(() => { expect(ctx.agents.get(spawned.member.id)).toBeUndefined() })
  })

  it('accepts provider-only and model-only seat routes', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath)
    await ctx.agentTeams.ensureInstitutionSquad(lead, {
      squadId: 'case',
      seats: [
        { name: 'notetaker', provider: 'mock' },
        { name: 'redactor', model: 'only-model' },
      ],
    })
    const caseRow = (await ctx.agentTeams.listInstitutionSquads()).find(row => row.id === 'case')
    expect(caseRow?.established).toBe(true)
    expect(caseRow?.seats.find(seat => seat.name === 'notetaker')?.provider).toBe('mock')
    expect(caseRow?.seats.find(seat => seat.name === 'redactor')?.model).toBeDefined()
  })

  it('spawns seats when the catalog stores an empty seat object', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath)
    writeFileSync(catalogPath, `${JSON.stringify({
      version: 1,
      leads: {},
      seats: { comms: { sourcer: {} } },
    }, null, 2)}\n`)
    const result = await ctx.agentTeams.ensureInstitutionSquad(lead, { squadId: 'comms' })
    expect(result.members.filter(member => member.role === 'teammate').map(member => member.name)).toEqual(
      INSTITUTION_SQUADS[2]!.seats.map(seat => seat.name),
    )
  })

  it('ensures a squad with no stored seat map', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath)
    const result = await ctx.agentTeams.ensureInstitutionSquad(lead, { squadId: 'document' })
    expect(result.members.filter(member => member.role === 'teammate')).toHaveLength(
      INSTITUTION_SQUADS[0]!.seats.length,
    )
  })

  it('rejects an unknown squad slug', async () => {
    const catalogPath = join(mkdtempSync(join(tmpdir(), 'dsh-inst-cat-')), 'institution-squads.json')
    roots.push(dirnameOf(catalogPath))
    const { ctx, lead } = await setup(catalogPath)
    await expect(ctx.agentTeams.ensureInstitutionSquad(lead, { squadId: 'sales' as never })).rejects.toSatisfy(
      (error: unknown) => error instanceof TeamError && error.code === 'TEAM_INSTITUTION_SQUAD_UNKNOWN',
    )
  })
})

function dirnameOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}
