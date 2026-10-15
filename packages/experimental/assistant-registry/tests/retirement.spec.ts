import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { setupAssistantHarness } from './harness.ts'

describe('Seat Retirement and Routing Rejection (S13)', { timeout: 30_000 }, () => {
  it('enforces pre-retirement safety check: blocks retirement when seat has pending/in-progress tasks unless forced', async () => {
    const harness = await setupAssistantHarness(
      [],
      {},
      { withCatalog: true, withAgentTeams: true },
    )
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Lead team',
      })
      const workerProfile = await harness.assistants.createProfile({
        name: 'Worker',
        responsibility: 'Execute tasks',
      })

      const team = await harness.assistants.createTeam({
        name: 'Ops Team',
        coordinatorProfileId: coordinator.id,
      })

      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'worker-1',
        duty: 'Process queues',
      })

      // Provision team so leadSessionId and lead Agent are live
      const provisioned = await harness.assistants.provisionTeam(team.id)
      const leadSessionId = provisioned.coordinatorSessionId
      const leadAgent = harness.ctx.agents.get(leadSessionId)!

      // Add a pending task owned by worker-1
      const task = await harness.ctx.agentTeams.createTask(leadAgent, {
        subject: 'Pending cleanup',
        description: 'Clean up dirty files',
      })
      await harness.ctx.agentTeams.updateTask(leadAgent, {
        taskId: task.id,
        expectedRevision: task.revision,
        action: 'reassign',
        owner: 'worker-1',
      })

      // Attempting to retire worker-1 seat fails because worker-1 has an in-progress/pending task
      await expect(
        harness.assistants.retireSeat(seat.id),
      ).rejects.toThrow(`Cannot retire seat '${seat.id}': seat has pending or in-progress tasks`)

      // Complete the task
      const inProgressTask = harness.ctx.agentTeams.listTasks(leadAgent).find(t => t.id === task.id)!
      await harness.ctx.agentTeams.updateTask(leadAgent, {
        taskId: task.id,
        expectedRevision: inProgressTask.revision,
        action: 'complete',
      })

      // Now retirement succeeds without force
      const retired = await harness.assistants.retireSeat(seat.id)
      expect(retired.retiredAt).toBeDefined()
      expect(retired.activeInstanceId).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })

  it('allows forced retirement when force=true is specified even with unfinished tasks', async () => {
    const harness = await setupAssistantHarness(
      [],
      {},
      { withCatalog: true, withAgentTeams: true },
    )
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Lead',
        responsibility: 'Lead operations',
      })
      const team = await harness.assistants.createTeam({
        name: 'Forced Ops',
        coordinatorProfileId: coordinator.id,
      })
      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: coordinator.id,
        role: 'teammate',
        name: 'worker-forced',
        duty: 'Execute duties',
      })

      const provisioned = await harness.assistants.provisionTeam(team.id)
      const leadAgent = harness.ctx.agents.get(provisioned.coordinatorSessionId)!

      const task = await harness.ctx.agentTeams.createTask(leadAgent, {
        subject: 'Unfinished task',
        description: 'Task in flight',
      })
      await harness.ctx.agentTeams.updateTask(leadAgent, {
        taskId: task.id,
        expectedRevision: task.revision,
        action: 'reassign',
        owner: 'worker-forced',
      })

      // Force retirement succeeds
      const retired = await harness.assistants.retireSeat(seat.id, { force: true })
      expect(retired.retiredAt).toBeDefined()
    } finally {
      await harness.dispose()
    }
  })

  it('persists durable retirement and rejects routing through submitPrompt, updateSeat, and setSeatModelOverride', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Analyst',
        responsibility: 'Analyze logs',
      })
      const team = await harness.assistants.createTeam({
        name: 'Audit Team',
        coordinatorProfileId: profile.id,
      })
      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: profile.id,
        role: 'teammate',
        name: 'auditor',
        duty: 'Audit events',
      })

      const childSession = SessionId('audit-child-session')
      await harness.assistants.bindSeatSession(seat.id, childSession)

      // Retire the seat
      const retired = await harness.assistants.retireSeat(seat.id)
      expect(retired.retiredAt).toBeDefined()
      expect(retired.activeInstanceId).toBeUndefined()

      // Calling retireSeat again is idempotent
      const retiredAgain = await harness.assistants.retireSeat(seat.id)
      expect(retiredAgain.retiredAt).toBe(retired.retiredAt)

      // 1. submitPrompt to retired session is rejected
      const promptReq: SessionPromptRequest = {
        sessionId: childSession,
        requestId: 'req-retire' as SessionRequestId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Run audit' }],
      }
      await expect(
        harness.assistants.submitPrompt(promptReq),
      ).rejects.toThrow(`Cannot submit prompt to retired seat '${seat.id}'`)

      // 2. updateSeat on retired seat is rejected
      await expect(
        harness.assistants.updateSeat(seat.id, { duty: 'New duty' }),
      ).rejects.toThrow(`Cannot update retired team seat '${seat.id}'`)

      // 3. setSeatModelOverride on retired seat is rejected
      await expect(
        harness.assistants.setSeatModelOverride(seat.id, { provider: 'mock', model: 'mock-model' }),
      ).rejects.toThrow(`Cannot update retired team seat '${seat.id}'`)
    } finally {
      await harness.dispose()
    }
  })

  it('enforces permanent name reservation: retired seat names cannot be reused by new seats or replacements', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Lead',
        responsibility: 'Lead',
      })
      const team = await harness.assistants.createTeam({
        name: 'Alpha Team',
        coordinatorProfileId: coordinator.id,
      })

      const seatA = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: coordinator.id,
        role: 'teammate',
        name: 'specialist-omega',
        duty: 'Specialist work',
      })

      // Bind an instance to seatA
      const instA = SessionId('inst-omega-1')
      await harness.assistants.bindSeatSession(seatA.id, instA)

      // Retire seatA
      await harness.assistants.retireSeat(seatA.id)

      // Attempting to create a new seat with the retired name 'specialist-omega' in the same team fails
      await expect(
        harness.assistants.createSeat({
          teamId: team.id,
          profileId: coordinator.id,
          role: 'teammate',
          name: 'specialist-omega',
          duty: 'New specialist',
        }),
      ).rejects.toThrow(`Teammate name 'specialist-omega' is permanently reserved in team '${team.id}'`)

      // Create another seat B with a unique name
      const seatB = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: coordinator.id,
        role: 'teammate',
        name: 'specialist-beta',
        duty: 'Beta duties',
      })

      // Attempting to replace instance on seat B using retired name or existing instance name fails
      await expect(
        harness.assistants.replaceSeatInstance(seatB.id, 'specialist-omega'),
      ).rejects.toThrow(`Instance name 'specialist-omega' is permanently reserved in team '${team.id}'`)

      await expect(
        harness.assistants.replaceSeatInstance(seatB.id, 'inst-omega-1'),
      ).rejects.toThrow(`Instance name 'inst-omega-1' is permanently reserved in team '${team.id}'`)
    } finally {
      await harness.dispose()
    }
  })
})
