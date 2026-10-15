import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness } from './harness.ts'
import type { TeamDefinitionId, TeamSeatId } from '../src/types.ts'

describe('Team Capacity Accounting and Seat Replacement (S13)', () => {
  it('counts live instances for capacity; retired seats free capacity while keeping history', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Lead Architect',
        responsibility: 'Lead development team',
      })
      const workerProfile = await harness.assistants.createProfile({
        name: 'Engineer',
        responsibility: 'Implement features',
      })

      const team = await harness.assistants.createTeam({
        name: 'Core Platform Team',
        coordinatorProfileId: coordinator.id,
      })

      // Initially 0 seats
      const initialCapacity = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(initialCapacity).toEqual({
        teamId: team.id,
        maxCapacity: 5,
        liveCount: 0,
        retiredCount: 0,
        totalHistoricalSeats: 0,
        availableSlots: 5,
      })

      // Add 3 live seats
      const seat1 = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'engineer-alpha',
        duty: 'Backend engine',
      })
      const seat2 = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'engineer-beta',
        duty: 'Frontend UI',
      })
      const seat3 = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'engineer-gamma',
        duty: 'QA and verification',
      })

      // Capacity with 3 live seats: liveCount=3, retiredCount=0, total=3, available=2
      const capWith3 = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(capWith3.liveCount).toBe(3)
      expect(capWith3.retiredCount).toBe(0)
      expect(capWith3.totalHistoricalSeats).toBe(3)
      expect(capWith3.availableSlots).toBe(2)

      // Retire seat2: liveCount drops to 2, retiredCount becomes 1, availableSlots increases to 3
      await harness.assistants.retireSeat(seat2.id)

      const capAfterRetire1 = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(capAfterRetire1.liveCount).toBe(2)
      expect(capAfterRetire1.retiredCount).toBe(1)
      expect(capAfterRetire1.totalHistoricalSeats).toBe(3)
      expect(capAfterRetire1.availableSlots).toBe(3)

      // Retire seat3: liveCount drops to 1, retiredCount becomes 2, availableSlots increases to 4
      await harness.assistants.retireSeat(seat3.id)

      const capAfterRetire2 = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(capAfterRetire2.liveCount).toBe(1)
      expect(capAfterRetire2.retiredCount).toBe(2)
      expect(capAfterRetire2.totalHistoricalSeats).toBe(3)
      expect(capAfterRetire2.availableSlots).toBe(4)

      // Seat 1 is still live
      const seat1Record = await harness.assistants.getSeat(seat1.id)
      expect(seat1Record?.retiredAt).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })

  it('replaces failed spawn instance: preserves logical seat ID, preserves failed history, and does not consume extra capacity', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Lead team',
      })
      const workerProfile = await harness.assistants.createProfile({
        name: 'Worker',
        responsibility: 'Execute duties',
      })

      const team = await harness.assistants.createTeam({
        name: 'Execution Team',
        coordinatorProfileId: coordinator.id,
      })

      const seat = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'worker-delta',
        duty: 'Processing pipeline',
      })

      // Simulate initial failed spawn instance bound to seat
      const failedSessionId = SessionId('inst-delta-1-failed')
      await harness.assistants.bindSeatSession(seat.id, failedSessionId)

      const seatRecord = (await harness.assistants.getSeat(seat.id))!
      expect(seatRecord.activeInstanceId).toBe(failedSessionId)
      expect(seatRecord.runtimeInstances).toEqual([failedSessionId])

      // Capacity accounting reports 1 live seat
      const beforeReplaceCap = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(beforeReplaceCap.liveCount).toBe(1)
      expect(beforeReplaceCap.totalHistoricalSeats).toBe(1)
      expect(beforeReplaceCap.availableSlots).toBe(4)

      // Replace the failed spawn with a new instance
      const retrySessionId = SessionId('inst-delta-2-retry')
      const replacedSeat = await harness.assistants.replaceSeatInstance(seat.id, retrySessionId)

      // 1. Logical seat id is preserved
      expect(replacedSeat.id).toBe(seat.id)
      expect(replacedSeat.name).toBe('worker-delta')

      // 2. Active instance is updated to the retry instance
      expect(replacedSeat.activeInstanceId).toBe(retrySessionId)

      // 3. Runtime instances history preserves the failed instance
      expect(replacedSeat.runtimeInstances).toEqual([failedSessionId, retrySessionId])

      // 4. Replacement does not consume extra capacity
      const afterReplaceCap = await harness.assistants.getCapacityAccounting(team.id, 5)
      expect(afterReplaceCap.liveCount).toBe(1)
      expect(afterReplaceCap.retiredCount).toBe(0)
      expect(afterReplaceCap.totalHistoricalSeats).toBe(1)
      expect(afterReplaceCap.availableSlots).toBe(4)

      // 5. Session lookup maps the new instance to the seat
      expect(harness.assistants.isAssistantBound(retrySessionId)).toBe(true)
    } finally {
      await harness.dispose()
    }
  })

  it('enforces permanent name reservation: failed and retired instance names cannot be reused', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const coordinator = await harness.assistants.createProfile({
        name: 'Coordinator',
        responsibility: 'Lead team',
      })
      const workerProfile = await harness.assistants.createProfile({
        name: 'Worker',
        responsibility: 'Execute duties',
      })

      const team = await harness.assistants.createTeam({
        name: 'Reservation Team',
        coordinatorProfileId: coordinator.id,
      })

      const seatA = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'worker-primary',
        duty: 'Primary duties',
      })

      const failedInst = SessionId('inst-prim-1-failed')
      await harness.assistants.bindSeatSession(seatA.id, failedInst)

      // Replace instance on seatA
      await harness.assistants.replaceSeatInstance(seatA.id, 'inst-prim-2-live')

      // Create a second seat B
      const seatB = await harness.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'worker-secondary',
        duty: 'Secondary duties',
      })

      // 1. Cannot replace seat B instance with the failed instance name of seat A
      await expect(
        harness.assistants.replaceSeatInstance(seatB.id, failedInst),
      ).rejects.toThrow(`Instance name '${failedInst}' is permanently reserved in team '${team.id}'`)

      // 2. Cannot replace seat B instance with the active instance name of seat A
      await expect(
        harness.assistants.replaceSeatInstance(seatB.id, 'inst-prim-2-live'),
      ).rejects.toThrow(`Instance name 'inst-prim-2-live' is permanently reserved in team '${team.id}'`)

      // 3. Cannot create a new seat using any historical instance name
      await expect(
        harness.assistants.createSeat({
          teamId: team.id,
          profileId: workerProfile.id,
          role: 'teammate',
          name: failedInst,
          duty: 'New worker',
        }),
      ).rejects.toThrow(`Teammate name '${failedInst}' is permanently reserved in team '${team.id}'`)

      // 4. Cannot replace an instance on a retired seat
      await harness.assistants.retireSeat(seatA.id)
      await expect(
        harness.assistants.replaceSeatInstance(seatA.id, 'inst-prim-3'),
      ).rejects.toThrow(`Cannot replace instance on retired team seat '${seatA.id}'`)
    } finally {
      await harness.dispose()
    }
  })

  it('persists capacity accounting and seat replacement across cold catalog reload', async () => {
    const harness1 = await setupAssistantHarness([], {}, { withCatalog: true })
    const storageRoot = harness1.storageRoot
    let teamId!: TeamDefinitionId
    let liveSeatId!: TeamSeatId
    let retiredSeatId!: TeamSeatId
    const failedInst = SessionId('inst-persist-1-failed')
    const activeInst = SessionId('inst-persist-2-active')

    try {
      const coordinator = await harness1.assistants.createProfile({
        name: 'Lead',
        responsibility: 'Lead team',
      })
      const workerProfile = await harness1.assistants.createProfile({
        name: 'Worker',
        responsibility: 'Run tasks',
      })

      const team = await harness1.assistants.createTeam({
        name: 'Persistent Ops',
        coordinatorProfileId: coordinator.id,
      })
      teamId = team.id

      const liveSeat = await harness1.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'persisted-live',
        duty: 'Live duties',
      })
      liveSeatId = liveSeat.id

      const retiredSeat = await harness1.assistants.createSeat({
        teamId: team.id,
        profileId: workerProfile.id,
        role: 'teammate',
        name: 'persisted-retired',
        duty: 'Temporary duties',
      })
      retiredSeatId = retiredSeat.id

      // Bind failed instance to liveSeat then replace it
      await harness1.assistants.bindSeatSession(liveSeat.id, failedInst)
      await harness1.assistants.replaceSeatInstance(liveSeat.id, activeInst)

      // Retire the retiredSeat
      await harness1.assistants.retireSeat(retiredSeat.id)

      // Verify before restart
      const capBefore = await harness1.assistants.getCapacityAccounting(team.id, 10)
      expect(capBefore.liveCount).toBe(1)
      expect(capBefore.retiredCount).toBe(1)
      expect(capBefore.totalHistoricalSeats).toBe(2)
      expect(capBefore.availableSlots).toBe(9)
    } finally {
      await harness1.dispose(true)
    }

    // Cold restart: boot second harness on same storageRoot
    const harness2 = await setupAssistantHarness([], {}, { withCatalog: true, storageRoot })
    try {
      // 1. Verify capacity accounting across restart
      const capAfter = await harness2.assistants.getCapacityAccounting(teamId, 10)
      expect(capAfter.liveCount).toBe(1)
      expect(capAfter.retiredCount).toBe(1)
      expect(capAfter.totalHistoricalSeats).toBe(2)
      expect(capAfter.availableSlots).toBe(9)

      // 2. Verify replaced seat details
      const liveSeatRecord = (await harness2.assistants.getSeat(liveSeatId))!
      expect(liveSeatRecord.activeInstanceId).toBe(activeInst)
      expect(liveSeatRecord.runtimeInstances).toEqual([failedInst, activeInst])
      expect(liveSeatRecord.retiredAt).toBeUndefined()

      // 3. Verify retired seat details
      const retiredSeatRecord = (await harness2.assistants.getSeat(retiredSeatId))!
      expect(retiredSeatRecord.activeInstanceId).toBeUndefined()
      expect(retiredSeatRecord.retiredAt).toBeDefined()

      // 4. Permanent name reservation persists across restart
      await expect(
        harness2.assistants.createSeat({
          teamId,
          profileId: liveSeatRecord.profileId,
          role: 'teammate',
          name: 'persisted-retired',
          duty: 'Conflict',
        }),
      ).rejects.toThrow(`Teammate name 'persisted-retired' is permanently reserved in team '${teamId}'`)

      await expect(
        harness2.assistants.createSeat({
          teamId,
          profileId: liveSeatRecord.profileId,
          role: 'teammate',
          name: failedInst,
          duty: 'Conflict',
        }),
      ).rejects.toThrow(`Teammate name '${failedInst}' is permanently reserved in team '${teamId}'`)
    } finally {
      await harness2.dispose()
    }
  })
})
