/** Persistent metadata edits and failed-save behavior through the UI-facing Host operations. */
import { rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ProvisioningOperationId } from '../src/types.ts'
import { describe, expect, it, vi } from 'vitest'
import { setupAssistantHarness } from './harness.ts'

async function fixture() {
  const h = await setupAssistantHarness()
  const profile = await h.assistants.createProfile({
    name: 'Workflow',
    responsibility: 'Coordinate',
    defaultModel: { provider: 'mock', model: 'profile-default' },
  })
  const { team, seats } = await h.assistants.createTeamFromTemplate('blank', {
    coordinatorProfileId: profile.id,
    name: 'Workflow team',
  })
  await h.assistants.bindSeatSession(seats[0]!.id, h.lead.id)
  return { h, profile, team, seat: seats[0]! }
}

describe('Assistant and team metadata workflows', () => {
  it('retains team initials and preset icons through create, template creation, update, and cold reload', async () => {
    const { h, profile } = await fixture()
    let reopened: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    try {
      const direct = await h.assistants.remoteCreateTeam({ name: 'Initials', coordinatorProfileId: profile.id, avatar: 'AB' })
      expect(direct.avatar).toBe('AB')
      const preset = await h.assistants.remoteCreateTeamFromTemplate('blank', {
        coordinatorProfileId: profile.id,
        name: 'Preset',
        avatar: 'icon:briefcase',
      })
      expect(preset.team.avatar).toBe('icon:briefcase')
      const updated = await h.assistants.remoteUpdateTeam(direct.id, direct.revision, { avatar: 'icon:users' })
      expect(updated.avatar).toBe('icon:users')
      await h.dispose(true)
      reopened = await setupAssistantHarness([], {}, { storageRoot: h.storageRoot })
      expect((await reopened.assistants.getTeam(direct.id))?.avatar).toBe('icon:users')
      expect((await reopened.assistants.getTeam(preset.team.id))?.avatar).toBe('icon:briefcase')
      expect((await reopened.assistants.remoteListTeams()).some(team => team.id === direct.id)).toBe(true)
    } finally {
      await reopened?.dispose()
      rmSync(h.storageRoot, { recursive: true, force: true })
    }
  })

  it('rejects an invalid model before persisting any part of a combined seat edit', async () => {
    const { h, seat } = await fixture()
    try {
      await expect(
        h.assistants.remoteUpdateSeat(seat.id, { duty: 'Changed duty', modelOverride: { provider: 'missing', model: 'missing' } }),
      ).rejects.toThrow()
      expect((await h.assistants.getSeat(seat.id))?.duty).toBe(seat.duty)
    } finally {
      await h.dispose()
    }
  })

  it('keeps seat routing unchanged when durable override storage fails', async () => {
    const { h, seat } = await fixture()
    try {
      const before = h.assistants.resolveEffectiveRoute(h.lead.id)
      vi.spyOn(h.catalog!, 'updateSeat').mockRejectedValueOnce(new Error('Synthetic disk failure'))
      await expect(h.assistants.setSeatModelOverride(seat.id, { provider: 'mock', model: 'uncommitted-route' })).rejects.toThrow(
        'Synthetic disk failure',
      )
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)).toEqual(before)
    } finally {
      await h.dispose()
    }
  })

  it('keeps conversation routing unchanged when durable override storage fails', async () => {
    const { h, profile } = await fixture()
    try {
      const conversation = await h.assistants.createConversation(profile.id)
      vi.spyOn(h.catalog!, 'updateConversation').mockRejectedValueOnce(new Error('Synthetic disk failure'))
      await expect(
        h.assistants.setConversationModelOverride(conversation.id, { provider: 'mock', model: 'uncommitted-route' }),
      ).rejects.toThrow('Synthetic disk failure')
      expect((await h.assistants.getConversation(conversation.id))?.modelOverride).toBeUndefined()
      expect(h.assistants.resolveEffectiveRoute(conversation.rootSessionId)?.route.model).toBe('profile-default')
    } finally {
      await h.dispose()
    }
  })

  it('clears seat overrides atomically through the nullable UI operation', async () => {
    const { h, seat } = await fixture()
    try {
      await h.assistants.remoteUpdateSeat(seat.id, { duty: 'Edited duty', modelOverride: { provider: 'mock', model: 'seat-specific' } })
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)?.route.model).toBe('seat-specific')
      await h.assistants.remoteUpdateSeat(seat.id, { modelOverride: null })
      expect((await h.assistants.getSeat(seat.id))?.duty).toBe('Edited duty')
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)?.route.model).toBe('profile-default')
    } finally {
      await h.dispose()
    }
  })

  it('keeps the saved conversation override active if clearing it cannot persist', async () => {
    const { h, profile } = await fixture()
    try {
      const conversation = await h.assistants.createConversation(profile.id)
      await h.assistants.setConversationModelOverride(conversation.id, { provider: 'mock', model: 'saved-override' })
      const before = h.assistants.resolveEffectiveRoute(conversation.rootSessionId)
      vi.spyOn(h.catalog!, 'updateConversation').mockRejectedValueOnce(new Error('Synthetic clear failure'))
      await expect(h.assistants.clearConversationModelOverride(conversation.id)).rejects.toThrow('Synthetic clear failure')
      expect(h.assistants.resolveEffectiveRoute(conversation.rootSessionId)).toEqual(before)
    } finally {
      await h.dispose()
    }
  })

  it('does not allow an update to bypass retired-seat immutability by supplying a retirement timestamp', async () => {
    const { h, seat } = await fixture()
    try {
      const retired = await h.assistants.retireSeat(seat.id)
      await expect(h.assistants.updateSeat(seat.id, { retiredAt: retired.retiredAt, duty: 'Mutated retired duty' })).rejects.toThrow(
        /retired/,
      )
      await expect(h.catalog!.updateSeat(seat.id, { retiredAt: retired.retiredAt, duty: 'Mutated retired duty' })).rejects.toThrow(
        /retired/,
      )
      expect((await h.assistants.getSeat(seat.id))?.duty).toBe(seat.duty)
    } finally {
      await h.dispose()
    }
  })
  it('preserves coordinator identity and routing when an initialized roster rejects profile replacement', async () => {
    const { h, team, seat, profile } = await fixture()
    try {
      const replacement = await h.assistants.createProfile({
        name: 'Replacement',
        responsibility: 'Different role',
        defaultModel: { provider: 'mock', model: 'different-model' },
      })
      const before = h.assistants.resolveEffectiveRoute(h.lead.id)
      await expect(h.assistants.updateTeam(team.id, team.revision, { coordinatorProfileId: replacement.id })).rejects.toThrow(
        /roster is initialized/,
      )
      expect((await h.assistants.getTeam(team.id))?.coordinatorProfileId).toBe(profile.id)
      expect((await h.assistants.getSeat(seat.id))?.profileId).toBe(profile.id)
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)).toEqual(before)
      const empty = await h.assistants.createTeam({ name: 'No roster', coordinatorProfileId: profile.id })
      const changed = await h.assistants.updateTeam(empty.id, empty.revision, { coordinatorProfileId: replacement.id })
      expect(changed.coordinatorProfileId).toBe(replacement.id)
      const coordinator = await h.assistants.createSeat({
        teamId: empty.id,
        profileId: replacement.id,
        role: 'coordinator',
        name: 'lead',
        duty: 'Different role',
      })
      await h.assistants.bindSeatSession(coordinator.id, h.lead.id)
      expect(h.assistants.resolveEffectiveRoute(h.lead.id)?.route.model).toBe('different-model')
    } finally {
      await h.dispose()
    }
  })

  it('reads live team activity without provisioning dormant saved teams', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const profile = await h.assistants.createProfile({
        name: 'Activity',
        responsibility: 'Coordinate',
        defaultModel: { provider: 'mock', model: 'activity-model' },
      })
      const { team } = await h.assistants.createTeamFromTemplate('blank', { coordinatorProfileId: profile.id })
      const provision = vi.spyOn(h.assistants, 'provisionTeam')
      expect(await h.assistants.getTeamActivity(team.id)).toBeUndefined()
      expect(provision).not.toHaveBeenCalled()
      await h.assistants.provisionTeam(team.id)
      const view = await h.assistants.getTeamActivity(team.id)
      expect(view?.members.some(member => member.role === 'lead')).toBe(true)
      expect(view?.tasks).toEqual([])
    } finally {
      await h.dispose()
    }
  })

  it('repairs a legacy empty roster only on explicit provisioning and admits its coordinator to rounds', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const profile = await h.assistants.createProfile({
        name: 'Existing coordinator',
        responsibility: 'Keep original coordinator duty',
        defaultModel: { provider: 'mock', model: 'original-route' },
      })
      const team = await h.assistants.createTeam({ name: 'Legacy empty', coordinatorProfileId: profile.id })
      expect(await h.assistants.getTeamActivity(team.id)).toBeUndefined()
      expect(await h.assistants.listSeats(team.id)).toEqual([])
      const [first, second] = await Promise.all([h.assistants.provisionTeam(team.id), h.assistants.provisionTeam(team.id)])
      expect(second.coordinatorSessionId).toBe(first.coordinatorSessionId)
      const seats = await h.assistants.listSeats(team.id)
      expect(seats).toHaveLength(1)
      expect(seats[0]).toMatchObject({
        role: 'coordinator',
        profileId: profile.id,
        duty: profile.responsibility,
        activeInstanceId: first.coordinatorSessionId,
      })
      expect(first.team.id).toBe(team.id)
      expect(h.assistants.resolveEffectiveRoute(first.coordinatorSessionId)?.route.model).toBe('original-route')
      const discussion = await h.assistants.createDiscussion({ teamId: team.id })
      const round = await h.assistants.scheduleRound({ teamId: team.id, discussionId: discussion.id, prompt: 'Explicit task' })
      expect(round.slots).toHaveLength(1)
      expect(round.slots[0]?.seatId).toBe(seats[0]!.id)
    } finally {
      await h.dispose()
    }
  })

  it('repairs a previously provisioned empty roster without replacing its coordinator history', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const profile = await h.assistants.createProfile({ name: 'Existing', responsibility: 'Original duty' })
      const team = await h.assistants.createTeam({ name: 'Old provisioned empty', coordinatorProfileId: profile.id })
      const conversation = await h.assistants.createConversation(profile.id)
      await h.assistants.updateTeam(team.id, team.revision, { leadSessionId: conversation.rootSessionId })
      const operationId = ProvisioningOperationId(`provision-team:${team.id}:${createHash('sha256').update('').digest('hex').slice(0, 12)}`)
      await h.catalog!.executeProvisioning({
        id: operationId,
        payload: { teamId: String(team.id), seats: [] },
        run: async () => ({ coordinator: String(conversation.rootSessionId) }),
      })
      const allocate = vi.spyOn(h.assistants, 'createConversation')
      const result = await h.assistants.provisionTeam(team.id)
      expect(result.coordinatorSessionId).toBe(conversation.rootSessionId)
      expect(allocate).not.toHaveBeenCalled()
      const [seat] = await h.assistants.listSeats(team.id)
      expect(seat).toMatchObject({ profileId: profile.id, duty: profile.responsibility, activeInstanceId: conversation.rootSessionId })
      expect((await h.assistants.getConversation(conversation.id))?.rootSessionId).toBe(conversation.rootSessionId)
    } finally {
      await h.dispose()
    }
  })

  it('finishes an interrupted legacy coordinator repair against the existing completed provisioning ledger', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const profile = await h.assistants.createProfile({ name: 'Existing', responsibility: 'Original duty' })
      const team = await h.assistants.createTeam({ name: 'Interrupted repair', coordinatorProfileId: profile.id })
      const conversation = await h.assistants.createConversation(profile.id)
      await h.assistants.updateTeam(team.id, team.revision, { leadSessionId: conversation.rootSessionId })
      const operationId = ProvisioningOperationId(`provision-team:${team.id}:${createHash('sha256').update('').digest('hex').slice(0, 12)}`)
      await h.catalog!.executeProvisioning({
        id: operationId,
        payload: { teamId: String(team.id), seats: [] },
        run: async () => ({ coordinator: String(conversation.rootSessionId) }),
      })
      const interruptedSeat = await h.assistants.createSeat({
        teamId: team.id,
        profileId: profile.id,
        role: 'coordinator',
        name: 'coordinator',
        duty: 'Original duty',
      })
      const allocate = vi.spyOn(h.assistants, 'createConversation')
      const result = await h.assistants.provisionTeam(team.id)
      expect(result.coordinatorSessionId).toBe(conversation.rootSessionId)
      expect(allocate).not.toHaveBeenCalled()
      expect(await h.assistants.listSeats(team.id)).toHaveLength(1)
      expect(await h.assistants.getSeat(interruptedSeat.id)).toMatchObject({
        activeInstanceId: conversation.rootSessionId,
        runtimeInstances: [conversation.rootSessionId],
      })
    } finally {
      await h.dispose()
    }
  })

  it('refuses foreign live team activity after a saved lead is rebound to another team', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const profile = await h.assistants.createProfile({ name: 'Coordinator', responsibility: 'Lead' })
      const a = await h.assistants.createTeamFromTemplate('document', { coordinatorProfileId: profile.id, name: 'Team A' })
      const live = await h.assistants.provisionTeam(a.team.id)
      const ownView = await h.assistants.getTeamActivity(a.team.id)
      expect(ownView?.members).toHaveLength(5)
      expect(ownView?.members.some(member => member.name === 'metric-checker')).toBe(true)
      const b = await h.assistants.createTeamFromTemplate('blank', { coordinatorProfileId: profile.id, name: 'Team B' })
      await h.assistants.updateTeam(b.team.id, b.team.revision, { leadSessionId: live.coordinatorSessionId })
      expect(await h.assistants.getTeamActivity(b.team.id)).toBeUndefined()
      expect((await h.assistants.getTeamActivity(a.team.id))?.members).toHaveLength(5)
    } finally {
      await h.dispose()
    }
  })
})
