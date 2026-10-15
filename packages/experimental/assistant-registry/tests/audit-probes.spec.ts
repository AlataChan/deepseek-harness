import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setupAssistantHarness } from './harness.ts'
import { intersectCapabilities, installScopeEnforcement } from '../src/scope-enforcement.ts'

describe('Independent S1-S16 acceptance probes', { timeout: 30_000 }, () => {
  it('opens the persistent catalog without fixture-only attachment', async () => {
    const h = await setupAssistantHarness()
    try { expect(h.assistants.catalog).toBeDefined() } finally { await h.dispose() }
  })

  it('denies all paths when policies have no common directory', () => {
    const p = intersectCapabilities({ allowedPaths: ['/team-a'] }, { allowedPaths: ['/team-b'] })
    expect(p.isPathPermitted('/team-b/secret.txt')).toBe(false)
  })

  it('denies the actual terminal tool names under allowTerminal=false', () => {
    const p = intersectCapabilities({ allowTerminal: false })
    expect(p.isToolPermitted('terminal_open')).toBe(false)
  })

  it('checks the shipped filesystem argument file_path before execution', async () => {
    const h = await setupAssistantHarness()
    let ran = false
    try {
      h.lead.ctx.tools.register(defineTool({
        name: 'audit_read', description: 'Synthetic filesystem argument probe',
        parameters: { file_path: { type: 'string', required: true } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { ran = true; return 'read' },
      }))
      installScopeEnforcement(h.lead, intersectCapabilities({ allowedPaths: ['/team-a'] }))
      await h.lead.ctx.tools.execute({
        callId: ToolCallId('audit-path'), name: 'audit_read',
        arguments: { file_path: '/team-b/secret.txt' }, agent: h.lead,
        signal: new AbortController().signal,
      })
      expect(ran).toBe(false)
    } finally { await h.dispose() }
  })

  it('enforces a profile policy on an already-live agent after binding', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    let ran = false
    try {
      h.lead.ctx.tools.register(defineTool({
        name: 'audit_bound', description: 'Synthetic bound policy probe', parameters: {},
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        async execute() { ran = true; return 'executed' },
      }))
      const p = await h.assistants.createProfile({ name: 'Restricted', responsibility: 'Work', capabilities: { allowedTools: [] } })
      await h.assistants.createConversation(p.id, h.lead.id)
      await h.lead.ctx.tools.execute({ callId: ToolCallId('audit-bound'), name: 'audit_bound', arguments: {}, agent: h.lead, signal: new AbortController().signal })
      expect(ran).toBe(false)
    } finally { await h.dispose() }
  })

  it('persists clearing a seat override and resumes profile inheritance', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work', defaultModel: { provider: 'mock', model: 'base' } })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id })
      const seat = await h.assistants.createSeat({ teamId: t.id, profileId: p.id, role: 'teammate', name: 'worker', duty: 'Work' })
      await h.assistants.bindSeatSession(seat.id, h.lead.id)
      await h.assistants.setSeatModelOverride(seat.id, { provider: 'mock', model: 'override' })
      await h.assistants.setSeatModelOverride(seat.id, undefined)
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)?.route.model).toBe('base')
      expect(h.catalog!.getSeat(seat.id)?.modelOverride).toBeUndefined()
    } finally { await h.dispose() }
  })

  it('rejects concurrent profile writes using the same expected revision', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work' })
      const r = await Promise.allSettled([
        h.catalog!.updateProfile(p.id, { name: 'A' }, p.revision),
        h.catalog!.updateProfile(p.id, { name: 'B' }, p.revision),
      ])
      expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    } finally { await h.dispose() }
  })

  it('rejects delivery to a retired seat through the existing Team mailbox', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work' })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id, leadSessionId: h.lead.id })
      const seat = await h.assistants.createSeat({ teamId: t.id, profileId: p.id, role: 'teammate', name: 'worker', duty: 'Work' })
      const spawned = await h.ctx.agentTeams.spawnTeammate(h.lead, {
        name: 'worker', description: 'Synthetic audit worker', context: 'fresh', provider: 'spawn',
        prompt: [{ type: 'text', text: 'Ready' }], signal: new AbortController().signal,
      })
      await h.assistants.bindSeatSession(seat.id, spawned.member.id)
      await h.assistants.retireSeat(seat.id, { force: true })
      await expect(h.ctx.agentTeams.sendMessage(h.lead, {
        target: 'worker', content: [{ type: 'text', text: 'After retirement' }],
        signal: new AbortController().signal,
      })).rejects.toThrow(/retir/i)
    } finally { await h.dispose() }
  })

  it('creates a real runtime session for a replacement instance', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work' })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id, leadSessionId: h.lead.id })
      const seat = await h.assistants.createSeat({ teamId: t.id, profileId: p.id, role: 'teammate', name: 'worker', duty: 'Work' })
      const replaced = await h.assistants.replaceSeatInstance(seat.id, 'worker-v2')
      expect(h.ctx.sessions.get(replaced.activeInstanceId!)).toBeDefined()
    } finally { await h.dispose() }
  })
  it('reconciles an existing runtime member after a crash before seat binding', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work' })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id, leadSessionId: h.lead.id })
      const seat = await h.assistants.createSeat({ teamId: t.id, profileId: p.id, role: 'teammate', name: 'worker', duty: 'Work' })
      const bind = vi.spyOn(h.assistants, 'bindSeatSession').mockRejectedValueOnce(new Error('AUDIT_CRASH_BEFORE_BIND'))
      await expect(h.assistants.provisionTeam(t.id)).rejects.toThrow('AUDIT_CRASH_BEFORE_BIND')
      bind.mockRestore()
      const member = h.ctx.agentTeams.listMembers(h.lead).find(m => m.name === 'worker')
      expect(member).toBeDefined()
      const retry = await h.assistants.provisionTeam(t.id)
      expect(retry.seatInstances.worker).toBe(member!.id)
      expect(h.assistants.getSeatSync(seat.id)?.activeInstanceId).toBe(member!.id)
    } finally { await h.dispose() }
  })

  it('runs a concurrent provisioning operation id only once', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    let allocations = 0
    try {
      const { ProvisioningOperationId } = await import('../src/types.ts')
      const options = { id: ProvisioningOperationId('audit-same-op'), payload: { name: 'Team' }, run: async () => { allocations++; return { id: 'allocation' } } }
      await Promise.all([h.catalog!.executeProvisioning(options), h.catalog!.executeProvisioning(options)])
      expect(allocations).toBe(1)
    } finally { await h.dispose() }
  })

})
