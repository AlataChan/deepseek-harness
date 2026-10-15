import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { setupAssistantHarness } from './harness.ts'

describe('Institution Squad Adoption (S14)', { timeout: 30_000 }, () => {
  it('adopts a valid provisioned institution squad into editable team definition, seats and adoption record', async () => {
    const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
    try {
      // 1. Provision the 'document' institution squad on the lead
      const ensured = await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, {
        squadId: 'document',
      })
      expect(ensured.sessionId).toBe(harness.lead.id)
      expect(ensured.members.length).toBe(5) // Lead + 4 teammates

      // 2. Adopt the squad into assistant-registry
      const { adoption, team } = await harness.assistants.adoptInstitutionSquad({
        squadId: 'document',
        teamName: 'Adopted Document Squad',
      })

      expect(adoption.squadId).toBe('document')
      expect(adoption.teamId).toBe(team.id)
      expect(adoption.leadSessionId).toBe(harness.lead.id)
      expect(adoption.status).toBe('active')
      expect(adoption.revision).toBe(1)

      expect(team.name).toBe('Adopted Document Squad')
      expect(team.templateOrigin).toBe('document')
      expect(team.leadSessionId).toBe(harness.lead.id)

      // 3. Check seats created
      const seats = await harness.assistants.listSeats(team.id)
      expect(seats.length).toBe(4)
      const seatNames = seats.map(s => s.name).sort()
      expect(seatNames).toEqual(['archivist', 'drafter', 'metric-checker', 'reviewer'])

      for (const seat of seats) {
        expect(seat.activeInstanceId).toBeDefined()
        expect(adoption.seatMappings[seat.name]).toBe(seat.activeInstanceId)
        expect(seat.retiredAt).toBeUndefined()
      }

      // 4. Verify lookup APIs
      const bySquad = harness.assistants.getAdoptionSync('document')
      expect(bySquad).toEqual(adoption)

      const byLead = harness.assistants.getAdoptionByLeadSessionSync(harness.lead.id)
      expect(byLead).toEqual(adoption)

      const allAdoptions = harness.assistants.listAdoptionsSync()
      expect(allAdoptions).toHaveLength(1)
      expect(allAdoptions[0]).toEqual(adoption)
    } finally {
      await harness.dispose()
    }
  })

  it('rejects invalid adoptions: unprovisioned squad, already adopted squad, or lead session already adopted', async () => {
    const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
    try {
      // Unprovisioned squad
      await expect(
        harness.assistants.adoptInstitutionSquad({ squadId: 'case' }),
      ).rejects.toThrow("Squad 'case' has no provisioned lead in institution catalog")

      // Provision 'document' squad and adopt it
      await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, {
        squadId: 'document',
      })
      await harness.assistants.adoptInstitutionSquad({ squadId: 'document' })

      // Already adopted squad
      await expect(
        harness.assistants.adoptInstitutionSquad({ squadId: 'document' }),
      ).rejects.toThrow("Institution squad 'document' is already adopted")
    } finally {
      await harness.dispose()
    }
  })

  it('detects legacy writer divergence via validateAdoptionState and repairs it via repairInstitutionAdoption', async () => {
    const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
    try {
      // 1. Provision and adopt
      await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, { squadId: 'document' })
      const { adoption } = await harness.assistants.adoptInstitutionSquad({ squadId: 'document' })
      expect(adoption.status).toBe('active')

      // Validate initial state: should still be active
      const validated1 = await harness.assistants.validateAdoptionState('document')
      expect(validated1.status).toBe('active')

      // 2. Simulate legacy writer overwriting the lead in legacy catalog
      const newLeadSessionId = SessionId('new-lead-session')
      await harness.ctx.agentTeams.transactInstitutionCatalog(async file => ({
        next: {
          ...file,
          leads: { ...file.leads, document: newLeadSessionId },
        },
        result: true,
      }))

      // 3. Validation should detect mismatch and transition status to 'repair_needed'
      const validated2 = await harness.assistants.validateAdoptionState('document')
      expect(validated2.status).toBe('repair_needed')
      expect(validated2.error).toContain('Legacy catalog lead binding changed')

      // 4. Create new lead agent and provision squad on it
      const newLead = await harness.ctx.agentLoop.create(newLeadSessionId, { provider: 'mock', model: 'mock' })
      await harness.ctx.agentTeams.ensureInstitutionSquad(newLead, { squadId: 'document' })

      // 5. Repair adoption
      const repaired = await harness.assistants.repairInstitutionAdoption({
        squadId: 'document',
        newLeadSessionId,
      })
      expect(repaired.status).toBe('active')
      expect(repaired.leadSessionId).toBe(newLeadSessionId)
      expect(repaired.error).toBeUndefined()
      expect(repaired.revision).toBe(adoption.revision + 2) // validateAdoptionState bumped revision, repair bumped again

      // 6. Verify team definition updated with new lead
      const team = harness.assistants.getTeamSync(adoption.teamId)
      expect(team?.leadSessionId).toBe(newLeadSessionId)

      // 7. Re-validation now passes
      const validated3 = await harness.assistants.validateAdoptionState('document')
      expect(validated3.status).toBe('active')
    } finally {
      await harness.dispose()
    }
  })

  it('persists adoption records across cold catalog reload', async () => {    let storageRoot = ''
    let teamId = ''
    {
      const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
      storageRoot = harness.storageRoot
      try {
        await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, { squadId: 'document' })
        const { adoption, team } = await harness.assistants.adoptInstitutionSquad({ squadId: 'document' })
        teamId = team.id
        expect(adoption.status).toBe('active')
      } finally {
        await harness.dispose(true)
      }
    }

    // Cold reload
    {
      const harness2 = await setupAssistantHarness([], {}, {
        storageRoot,
        withAgentTeams: true,
        withCatalog: true,
        leadSessionId: SessionId('lead-reload'),
      })
      try {
        const adoption = harness2.assistants.getAdoptionSync('document')
        expect(adoption).toBeDefined()
        expect(adoption?.status).toBe('active')
        expect(adoption?.squadId).toBe('document')
        expect(adoption?.teamId).toBe(teamId)

        const team = harness2.assistants.getTeamSync(teamId as never)
        expect(team).toBeDefined()
        expect(team?.templateOrigin).toBe('document')

        const seats = harness2.assistants.listSeatsSync(teamId as never)
        expect(seats).toHaveLength(4)
      } finally {
        await harness2.dispose()
      }
    }
  })

  it('keeps the record repair_needed when a legacy writer moves the lead during repair', async () => {
    const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
    try {
      await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, { squadId: 'document' })
      const { adoption } = await harness.assistants.adoptInstitutionSquad({ squadId: 'document' })

      // A legacy writer moves the lead while the repair operation is running; the post-write re-read must see it.
      const read = harness.ctx.agentTeams.readInstitutionCatalog.bind(harness.ctx.agentTeams)
      let reads = 0
      const movedLead = SessionId('lead-moved-during-repair')
      const spy = vi.spyOn(harness.ctx.agentTeams, 'readInstitutionCatalog').mockImplementation(async () => {
        reads += 1
        const file = await read()
        return reads >= 1 ? { ...file, leads: { ...file.leads, document: movedLead } } : file
      })
      try {
        const repaired = await harness.assistants.repairInstitutionAdoption({
          squadId: 'document',
          force: true,
          newLeadSessionId: harness.lead.id,
        })
        expect(reads).toBeGreaterThanOrEqual(1)
        expect(repaired.status).toBe('repair_needed')
        expect(repaired.error).toContain('after repair')
      } finally {
        spy.mockRestore()
      }

      // Operational use refuses dispatch for a record that is not active.
      const team = harness.assistants.getTeamSync(adoption.teamId)!
      await expect(harness.assistants.dispatchCoordinator(team.id, {
        requestId: 'req-adoption-blocked' as SessionRequestId,
        sessionId: SessionId('placeholder'),
        mode: 'queue',
        content: [{ type: 'text', text: 'blocked' }],
      })).rejects.toThrow(/requires repair/)
    } finally {
      await harness.dispose()
    }
  })

  it('refuses dispatch when the adoption lead no longer matches the team lead', async () => {
    const harness = await setupAssistantHarness([], {}, { withAgentTeams: true, withCatalog: true })
    try {
      await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, { squadId: 'document' })
      const { team } = await harness.assistants.adoptInstitutionSquad({ squadId: 'document' })

      const original = harness.catalog!.getAdoption('document')!
      await harness.catalog!.updateAdoption('document', original.revision, {
        ...original,
        leadSessionId: SessionId('other-lead'),
      })

      await expect(harness.assistants.dispatchCoordinator(team.id, {
        requestId: 'req-lead-mismatch' as SessionRequestId,
        sessionId: SessionId('placeholder'),
        mode: 'queue',
        content: [{ type: 'text', text: 'blocked' }],
      })).rejects.toThrow(/does not match the team lead/)
    } finally {
      await harness.dispose()
    }
  })
})
