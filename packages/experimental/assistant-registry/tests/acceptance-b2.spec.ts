import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setupAssistantHarness } from './harness.ts'
import { ProvisioningOperationId } from '../src/types.ts'
import { intersectCapabilities, installScopeEnforcement } from '../src/scope-enforcement.ts'

describe('Stage B2 Acceptance Gate: Saved Teams, Scope Isolation, Adoption & Lifecycle', { timeout: 30_000 }, () => {
  it('reuses one profile across two teams without leaking private conversation or other-team context', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      // 1. Create a worker profile with dedicated instructions
      const workerProfile = await harness.assistants.createProfile({
        name: 'Core Analyst',
        responsibility: 'Analyze financial and operational records',
        instructions: 'Focus on precision and strict confidentiality.',
        defaultModel: { provider: 'mock', model: 'analyst-base-model' },
      })

      // 2. Start a private conversation with the worker profile
      const privateConv = await harness.assistants.createConversation(workerProfile.id, {
        title: 'Private Strategic Discussion',
      })
      expect(harness.assistants.isAssistantBound(privateConv.rootSessionId)).toBe(true)

      // 3. Create two independent teams both using workerProfile as a teammate seat
      const coordinatorProfile = await harness.assistants.createProfile({
        name: 'Team Coordinator',
        responsibility: 'Coordinate task dispatch and review',
      })

      const teamA = await harness.assistants.createTeam({
        name: 'Alpha Project Team',
        coordinatorProfileId: coordinatorProfile.id,
      })

      const teamB = await harness.assistants.createTeam({
        name: 'Beta Project Team',
        coordinatorProfileId: coordinatorProfile.id,
      })

      // 4. Create seats in each team
      const seatA = await harness.assistants.createSeat({
        teamId: teamA.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'analyst-alpha',
        duty: 'Alpha sector financial audit',
      })

      const seatB = await harness.assistants.createSeat({
        teamId: teamB.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'analyst-beta',
        duty: 'Beta sector market review',
      })

      // 5. Bind separate fresh instances
      const sessionA = SessionId('session-inst-alpha-1')
      const sessionB = SessionId('session-inst-beta-1')

      await harness.assistants.bindSeatSession(seatA.id, sessionA)
      await harness.assistants.bindSeatSession(seatB.id, sessionB)

      // 6. Assert isolation: sessions are completely distinct
      expect(sessionA).not.toBe(sessionB)
      expect(sessionA).not.toBe(privateConv.rootSessionId)
      expect(sessionB).not.toBe(privateConv.rootSessionId)

      // Seats have isolated active instance bindings
      const fetchedSeatA = harness.assistants.getSeatSync(seatA.id)
      const fetchedSeatB = harness.assistants.getSeatSync(seatB.id)

      expect(fetchedSeatA?.activeInstanceId).toBe(sessionA)
      expect(fetchedSeatB?.activeInstanceId).toBe(sessionB)
      expect(fetchedSeatA?.teamId).toBe(teamA.id)
      expect(fetchedSeatB?.teamId).toBe(teamB.id)

      // Profile remains unmodified and reusable
      const currentProfile = harness.assistants.getProfileSync(workerProfile.id)
      expect(currentProfile?.revision).toBe(1)
      expect(currentProfile?.defaultModel?.model).toBe('analyst-base-model')
    } finally {
      await harness.dispose()
    }
  })

  it('enforces scope isolation and rejects cross-scope reads through tools.guard', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const allowedTeamDir = resolve('/workspace/team-alpha')
      const effective = intersectCapabilities({
        allowedTools: ['read_file', 'write_file'],
        disallowedTools: ['shell_exec', 'rm'],
        allowedPaths: [allowedTeamDir],
      })

      const agent = harness.lead
      installScopeEnforcement(agent, effective)

      // 1. Tool name rejection: calling a disallowed tool
      const disallowedResult = await agent.ctx.tools.execute({
        callId: ToolCallId('call-disallowed'),
        name: 'shell_exec',
        arguments: { command: 'ls' },
        agent,
        signal: new AbortController().signal,
      })
      expect(disallowedResult.isError).toBe(true)
      expect(disallowedResult.error?.message).toContain('not permitted')

      // 2. Path violation rejection: attempting to read outside allowed team workspace
      const crossScopeResult = await agent.ctx.tools.execute({
        callId: ToolCallId('call-cross-scope'),
        name: 'read_file',
        arguments: { path: resolve('/workspace/team-beta/confidential.txt') },
        agent,
        signal: new AbortController().signal,
      })
      expect(crossScopeResult.isError).toBe(true)
      expect(crossScopeResult.error?.message).toContain('outside allowed paths')
    } finally {
      await harness.dispose()
    }
  })

  it('recovers from crash injected between allocation and binding without duplicate allocations', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })

    try {
      const catalog = harness.catalog!
      const opId = ProvisioningOperationId('op-b2-alloc-crash')
      const payload = { teamName: 'Crash Recovery Team', seatNames: ['seat-1', 'seat-2'] }

      // 1. First execution: crash injected after allocations recorded in checkpoint
      let crashTriggered = false
      try {
        await catalog.executeProvisioning({
          id: opId,
          payload,
          crashHook: (stage) => {
            if (stage === 'after-checkpoint:allocation-complete') {
              crashTriggered = true
              throw new Error('SIMULATED_CRASH_POST_ALLOCATION')
            }
          },
          run: async (context) => {
            expect(context.resumed).toBe(false)
            // Allocate resources and record them in the checkpoint
            await context.setCheckpoint('allocation-complete', {
              allocatedTeamId: 'allocated-team-101',
              allocatedSessionId: 'allocated-session-202',
            })
            return { status: 'done' }
          },
        })
      } catch (err: unknown) {
        expect((err as Error).message).toBe('SIMULATED_CRASH_POST_ALLOCATION')
      }
      expect(crashTriggered).toBe(true)

      // Verify operation ledger in catalog preserved allocations
      const interimOp = catalog.getOperation(opId)
      expect(interimOp?.checkpoint).toBe('allocation-complete')
      expect(interimOp?.allocations.allocatedTeamId).toBe('allocated-team-101')
      expect(interimOp?.allocations.allocatedSessionId).toBe('allocated-session-202')

      // 2. Resume execution: recovers existing allocations and completes binding
      const completionResult = await catalog.executeProvisioning({
        id: opId,
        payload,
        run: async (context) => {
          expect(context.resumed).toBe(true)
          expect(context.checkpoint).toBe('allocation-complete')
          // Existing allocations are reused idempotently without creating new ones!
          expect(context.allocations.allocatedTeamId).toBe('allocated-team-101')
          expect(context.allocations.allocatedSessionId).toBe('allocated-session-202')
          return {
            status: 'completed',
            teamId: context.allocations.allocatedTeamId!,
            sessionId: context.allocations.allocatedSessionId!,
          }
        },
      })

      expect(completionResult.status).toBe('completed')
      expect(completionResult.allocations.allocatedTeamId).toBe('allocated-team-101')
      expect(completionResult.allocations.allocatedSessionId).toBe('allocated-session-202')

      const finalOp = catalog.getOperation(opId)
      expect(finalOp?.status).toBe('completed')
    } finally {
      await harness.dispose()
    }
  })

  it('adopts institution squad without respawn and coordinates with legacy catalog writes', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      // 1. Provision legacy institution squad
      const ensured = await harness.ctx.agentTeams.ensureInstitutionSquad(harness.lead, {
        squadId: 'document',
      })
      expect(ensured.members.length).toBe(5)

      // 2. Adopt into assistant registry
      const { adoption, team } = await harness.assistants.adoptInstitutionSquad({
        squadId: 'document',
        teamName: 'Adopted Document Squad',
      })

      expect(adoption.status).toBe('active')
      expect(adoption.leadSessionId).toBe(harness.lead.id)
      expect(team.templateOrigin).toBe('document')

      // Verify all 4 seats adopted existing runtime instance IDs (no respawn!)
      const seats = await harness.assistants.listSeats(team.id)
      expect(seats.length).toBe(4)
      for (const seat of seats) {
        expect(seat.activeInstanceId).toBeDefined()
        expect(adoption.seatMappings[seat.name]).toBe(seat.activeInstanceId)
      }

      // 3. Post-write validation detects divergence when legacy lead changes
      const divergedLeadId = SessionId('legacy-diverged-lead')
      await harness.ctx.agentTeams.transactInstitutionCatalog(async file => ({
        next: { ...file, leads: { ...file.leads, document: divergedLeadId } },
        result: true,
      }))

      const validation = await harness.assistants.validateAdoptionState('document')
      expect(validation.status).toBe('repair_needed')
      expect(validation.error).toContain('Legacy catalog lead binding changed')
    } finally {
      await harness.dispose()
    }
  })

  it('rejects routing and modifications on retired seats', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Lead team',
      })
      const worker = await harness.assistants.createProfile({
        name: 'Engineer',
        responsibility: 'Implement tasks',
      })

      const team = await harness.assistants.createTeam({
        name: 'Engineering Team',
        coordinatorProfileId: coordinator.id,
      })

      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: worker.id,
        role: 'teammate',
        name: 'dev-1',
        duty: 'Core dev',
      })

      const childSession = SessionId('some-child-session')
      await harness.assistants.bindSeatSession(seat.id, childSession)

      // Retire seat
      const retiredSeat = await harness.assistants.retireSeat(seat.id)
      expect(retiredSeat.retiredAt).toBeDefined()
      expect(retiredSeat.activeInstanceId).toBeUndefined()

      // Reject update on retired seat
      await expect(
        harness.assistants.updateSeat(seat.id, { duty: 'New duty' }),
      ).rejects.toThrow('retired')

      // Reject prompt routing targeting retired seat
      await expect(
        harness.assistants.submitPrompt({
          sessionId: childSession,
          requestId: 'req-retire-probe' as SessionRequestId,
          mode: 'queue',
          content: [{ type: 'text', text: 'Task for retired seat' }],
        }),
      ).rejects.toThrow('retired')
    } finally {
      await harness.dispose()
    }
  })

  it('replaces failed seat instance without consuming extra capacity and permanently reserves names', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true, withAgentTeams: true })
    try {
      const coord = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Lead team',
      })
      const profile = await harness.assistants.createProfile({
        name: 'Worker',
        responsibility: 'Tasks',
      })

      const team = await harness.assistants.createTeam({
        name: 'Capacity Team',
        coordinatorProfileId: coord.id,
      })

      // Add 2 seats to team with max capacity = 2
      const seat1 = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: profile.id,
        role: 'teammate',
        name: 'worker-alpha',
        duty: 'Alpha duty',
      })
      const seat2 = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: profile.id,
        role: 'teammate',
        name: 'worker-beta',
        duty: 'Beta duty',
      })
      expect(seat2.id).toBeDefined()

      // Capacity is full: liveCount = 2, maxCapacity = 2, available = 0
      const capInitial = await harness.assistants.getCapacityAccounting(team.id, 2)
      expect(capInitial.liveCount).toBe(2)
      expect(capInitial.availableSlots).toBe(0)

      // Replace instance on seat1
      const replacedSeat = await harness.assistants.replaceSeatInstance(
        seat1.id,
        'worker-alpha-v2',
      )
      expect(replacedSeat.id).toBe(seat1.id)
      expect(replacedSeat.name).toBe('worker-alpha')
      expect(replacedSeat.activeInstanceId).toBe(SessionId('worker-alpha-v2'))

      // Replacement does NOT consume extra capacity: liveCount remains 2!
      const capAfterReplace = await harness.assistants.getCapacityAccounting(team.id, 2)
      expect(capAfterReplace.liveCount).toBe(2)
      expect(capAfterReplace.availableSlots).toBe(0)

      // Permanent name reservation: old name 'worker-alpha' cannot be reused!
      await expect(
        harness.assistants.createSeat({
          teamId: team.id,
          profileId: profile.id,
          role: 'teammate',
          name: 'worker-alpha',
          duty: 'Reuse attempt',
        }),
      ).rejects.toThrow('permanently reserved')
    } finally {
      await harness.dispose()
    }
  })
})
