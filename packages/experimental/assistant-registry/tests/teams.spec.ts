import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { setupAssistantHarness } from './harness.ts'
import { RevisionConflictError } from '../src/errors.ts'
import { TEAM_TEMPLATES } from '../src/templates.ts'

describe('Saved Teams and Provisioning (S12)', { timeout: 30_000 }, () => {
  it('creates, retrieves, and lists saved teams with revision CAS checks', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Lead Coordinator',
        responsibility: 'Coordinate squad operations',
      })

      const team = await harness.assistants.createTeam({
        name: 'Alpha Squad',
        description: 'First response engineering team',
        coordinatorProfileId: coordinator.id,
        sharedWorkspaceId: '/workspace/alpha',
      })

      expect(team.id).toBeDefined()
      expect(team.name).toBe('Alpha Squad')
      expect(team.revision).toBe(1)
      expect(team.coordinatorProfileId).toBe(coordinator.id)
      expect(team.archivedAt).toBeUndefined()

      const fetched = await harness.assistants.getTeam(team.id)
      expect(fetched?.name).toBe('Alpha Squad')

      // CAS update success
      const updated = await harness.assistants.updateTeam(team.id, 1, {
        name: 'Alpha Squad V2',
        description: 'Updated description',
      })
      expect(updated.name).toBe('Alpha Squad V2')
      expect(updated.revision).toBe(2)

      // CAS conflict failure
      await expect(
        harness.assistants.updateTeam(team.id, 1, { name: 'Alpha Squad Stale' }),
      ).rejects.toThrow(RevisionConflictError)

      // Listing teams
      const activeTeams = await harness.assistants.listTeams(false)
      expect(activeTeams).toHaveLength(1)
      expect(activeTeams[0]?.id).toBe(team.id)

      // Archive team
      const archived = await harness.assistants.archiveTeam(team.id)
      expect(archived.archivedAt).toBeDefined()

      const activeAfterArchive = await harness.assistants.listTeams(false)
      expect(activeAfterArchive).toHaveLength(0)

      const allTeams = await harness.assistants.listTeams(true)
      expect(allTeams).toHaveLength(1)
      expect(allTeams[0]?.archivedAt).toBeDefined()
    } finally {
      await harness.dispose()
    }
  })

  it('instantiates editable independent team definitions and seats from templates', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Lead',
        responsibility: 'Lead operations',
      })

      for (const tpl of TEAM_TEMPLATES) {
        const { team, seats } = await harness.assistants.createTeamFromTemplate(tpl.id, {
          coordinatorProfileId: coordinator.id,
          name: `Custom ${tpl.name}`,
        })

        expect(team.name).toBe(`Custom ${tpl.name}`)
        expect(team.templateOrigin).toBe(tpl.id)
        expect(team.revision).toBeGreaterThanOrEqual(1)

        // Blank template has 1 seat (coordinator), others have coordinator + seats
        expect(seats.length).toBe(tpl.seats.length + 1)
        expect(seats[0]?.role).toBe('coordinator')
        expect(seats[0]?.profileId).toBe(coordinator.id)

        // Seats are editable independent entities
        if (seats.length > 1) {
          const teammateSeat = seats[1]!
          const updatedSeat = await harness.assistants.updateSeat(teammateSeat.id, {
            duty: 'Custom specialized duty',
          })
          expect(updatedSeat.duty).toBe('Custom specialized duty')
          // Template definition itself remains unaffected
          expect(tpl.seats[0]?.duty).not.toBe('Custom specialized duty')
        }
      }
    } finally {
      await harness.dispose()
    }
  })

  it('creates and manages seats with local model overrides and retirement', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Team lead',
        defaultModel: { provider: 'mock', model: 'mock-coord' },
      })
      const researcher = await harness.assistants.createProfile({
        name: 'Researcher',
        responsibility: 'Perform analysis',
        defaultModel: { provider: 'mock', model: 'mock-research' },
      })

      const team = await harness.assistants.createTeam({
        name: 'Research Team',
        coordinatorProfileId: coordinator.id,
      })

      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: researcher.id,
        role: 'teammate',
        name: 'analyst',
        duty: 'Analyze data',
        title: 'Analyst',
      })

      expect(seat.teamId).toBe(team.id)
      expect(seat.modelOverride).toBeUndefined()

      // Seat model override
      await harness.assistants.setSeatModelOverride(seat.id, {
        provider: 'mock',
        model: 'mock-override',
      })

      const seatWithOverride = await harness.assistants.getSeat(seat.id)
      expect(seatWithOverride?.modelOverride?.model).toBe('mock-override')

      // Bind runtime instance to seat
      const childSessionId = SessionId('child-session-1')
      await harness.assistants.bindSeatSession(seat.id, childSessionId)

      // When not bound to conversation yet, resolveEffectiveRoute needs conversation or seat
      expect(harness.assistants.getSeatSync(seat.id)?.runtimeInstances).toContain(childSessionId)

      // Retire seat
      const retired = await harness.assistants.retireSeat(seat.id)
      expect(retired.retiredAt).toBeDefined()

      // Attempting to submit prompt to retired seat session throws error
      const promptReq: SessionPromptRequest = {
        sessionId: childSessionId,
        requestId: 'req-team-retire' as SessionRequestId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Hello analyst' }],
      }
      await expect(
        harness.assistants.submitPrompt(promptReq),
      ).rejects.toThrow(`Cannot submit prompt to retired seat '${seat.id}'`)
    } finally {
      await harness.dispose()
    }
  })

  it('provisions team into live coordinator and spawned teammate instances', async () => {
    const harness = await setupAssistantHarness(
      [
        [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'Coordinator ready' }, { type: 'block-end', index: 0, block: { type: 'text', text: 'Coordinator ready' } }],
      ],
      {},
      { withCatalog: true, withAgentTeams: true },
    )
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Team lead',
      })

      const { team, seats } = await harness.assistants.createTeamFromTemplate('document', {
        coordinatorProfileId: coordinator.id,
        name: 'Document Team',
      })

      expect(seats.length).toBe(5) // 1 coordinator + 4 document squad seats

      // Provision team
      const provisioned = await harness.assistants.provisionTeam(team.id)
      expect(provisioned.coordinatorSessionId).toBeDefined()
      expect(provisioned.team.leadSessionId).toBe(provisioned.coordinatorSessionId)

      // Idempotent provisioning: calling provisionTeam again does not create duplicate sessions
      const secondProvision = await harness.assistants.provisionTeam(team.id)
      expect(secondProvision.coordinatorSessionId).toBe(provisioned.coordinatorSessionId)
    } finally {
      await harness.dispose()
    }
  })

  it('rejects submissions and provisioning for archived teams', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Team lead',
      })
      const team = await harness.assistants.createTeam({
        name: 'Archived Squad',
        coordinatorProfileId: coordinator.id,
      })

      await harness.assistants.archiveTeam(team.id)

      await expect(
        harness.assistants.provisionTeam(team.id),
      ).rejects.toThrow(`Cannot provision archived team '${team.id}'`)

      const promptReq: SessionPromptRequest = {
        sessionId: SessionId('some-session'),
        requestId: 'req-team-archived' as SessionRequestId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Hello' }],
      }
      await expect(
        harness.assistants.dispatchCoordinator(team.id, promptReq),
      ).rejects.toThrow(`Cannot submit prompt to archived team '${team.id}'`)
    } finally {
      await harness.dispose()
    }
  })

  it('executes coordinator-first dispatch to provisioned team lead', async () => {
    const harness = await setupAssistantHarness(
      [
        [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'Task accepted by coordinator' }, { type: 'block-end', index: 0, block: { type: 'text', text: 'Task accepted by coordinator' } }],
      ],
      {},
      { withCatalog: true, withAgentTeams: true },
    )
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Team lead',
      })
      const team = await harness.assistants.createTeam({
        name: 'Task Force',
        coordinatorProfileId: coordinator.id,
      })

      const result = await harness.assistants.dispatchCoordinator(team.id, {
        requestId: 'req-dispatch-1' as SessionRequestId,
        sessionId: SessionId('placeholder'),
        mode: 'queue',
        content: [{ type: 'text', text: 'Analyze documents' }],
      })

      expect(result).toBeDefined()
      const updatedTeam = await harness.assistants.getTeam(team.id)
      expect(updatedTeam?.leadSessionId).toBeDefined()
    } finally {
      await harness.dispose()
    }
  })
})
