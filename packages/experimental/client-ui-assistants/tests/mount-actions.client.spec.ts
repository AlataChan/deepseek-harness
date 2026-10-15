// @vitest-environment jsdom
/** Wire payloads and navigation retain saved-team identity without execution side effects. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AssistantProfileId, GroupRoundId, MemoryEntryId, TeamDefinitionId, TeamSeatId,
  type AssistantProfile, type TeamDefinition, type TeamSeat } from '@deepseek-ai/dsh-experimental-assistant-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerUi, type AssistantClientOps } from '../src/client/mount.ts'
import type { TeamDiscussionOps } from '../src/client/TeamDiscussion.tsx'
import type { AssistantDirectoryInjected } from '../src/client/AssistantDirectory.tsx'
import { zh } from '../src/client/locales.ts'

const profile: AssistantProfile = { id: AssistantProfileId('profile'), name: 'Assistant', responsibility: 'Assist', revision: 1, createdAt: 1, updatedAt: 1 }
const team: TeamDefinition = { id: TeamDefinitionId('team'), name: 'Team', coordinatorProfileId: profile.id, seatIds: [], leadSessionId: SessionId('lead'), revision: 1, createdAt: 1, updatedAt: 1 }
const seat: TeamSeat = { id: TeamSeatId('seat'), teamId: team.id, profileId: profile.id, name: 'writer', role: 'teammate', duty: 'Write', activeInstanceId: SessionId('child'), runtimeInstances: [SessionId('child')], createdAt: 1, updatedAt: 1 }

function injection(ops: AssistantClientOps = {}, remote?: object) {
  const ctx = new Context()
  let injected: AssistantDirectoryInjected | undefined
  const openSession = vi.fn()
  let startNewTopic: ((id: typeof profile.id) => unknown) | undefined
  ctx.slots = {
    inject: (_name: string, register: () => void) => { register() },
    register: (options: { name: string; inject?: (sessionId?: ReturnType<typeof SessionId>) => AssistantDirectoryInjected }) => {
      if (options.name === 'main') injected = options.inject?.()
      if (options.name === 'conversation.session.header.actions') {
        const candidate = options.inject?.(SessionId('lead'))
        if (candidate && 'onStartNewTopic' in candidate && typeof candidate.onStartNewTopic === 'function') {
          const action = candidate.onStartNewTopic
          startNewTopic = id => action(id)
        }
      }
      return () => {}
    },
  } as never
  ctx.locale = { register: () => () => {}, bind: () => makeTranslate(zh) } as never
  ctx.uiWorkspace = { openSession } as never
  if (remote) ctx.provide('remote', remote)
  registerUi(ctx, ops)
  if (!injected) throw new Error('Directory injection not registered')
  return { ctx, directory: injected, openSession, startNewTopic }
}

describe('Mounted assistant action wiring', () => {
  it('retains explicit null through JSON for seat model inheritance', async () => {
    const update = vi.fn().mockResolvedValue(seat)
    const { ctx, directory } = injection({ updateSeat: update })
    try {
      await directory.onUpdateSeat?.(seat.id, { modelOverride: null })
      expect(JSON.parse(JSON.stringify(update.mock.calls[0]?.[1]))).toEqual({ modelOverride: null })
    } finally { await ctx.fiber.dispose() }
  })

  it('promotes only into the selected target and propagates rejection without scanning teams', async () => {
    const promote = vi.fn().mockRejectedValue(new Error('not permitted'))
    const listTeams = vi.fn().mockResolvedValue([{ ...team, coordinatorProfileId: AssistantProfileId('foreign') }])
    const { ctx, directory } = injection({ promoteTeamMemoryToProfile: promote, listTeams })
    try {
      const id = MemoryEntryId('memory')
      await expect(directory.onPromoteMemory?.(id, profile.id)).rejects.toThrow('not permitted')
      expect(promote).toHaveBeenCalledExactlyOnceWith(id, profile.id, true)
      expect(listTeams).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('opens teammate history with its real parent and coordinator history directly', async () => {
    const { ctx, directory, openSession } = injection()
    try {
      directory.onViewActivityLog?.(seat, team.leadSessionId)
      expect(openSession).toHaveBeenCalledWith({ parentSessionId: team.leadSessionId, childSessionId: seat.activeInstanceId, mode: 'continuable' })
      directory.onViewActivityLog?.({ ...seat, role: 'coordinator', activeInstanceId: team.leadSessionId }, team.leadSessionId)
      expect(openSession).toHaveBeenLastCalledWith(team.leadSessionId)
      expect(directory.onOpenDock).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it('forwards read-only live activity by saved team identifier', async () => {
    const view = { members: [], tasks: [], interactions: [] }
    const read = vi.fn().mockResolvedValue(view)
    const create = vi.fn()
    const { ctx, directory } = injection({ getTeamActivity: read, createTeam: create })
    try {
      expect(await directory.loadLiveView?.(team.id)).toEqual(view)
      expect(read).toHaveBeenCalledExactlyOnceWith(team.id)
      expect(create).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects unavailable mutation capabilities instead of reporting success', async () => {
    const { ctx, directory } = injection()
    try {
      await expect(directory.onCreateProfile({ name: 'Draft' })).rejects.toThrow(zh.operationFailed)
      await expect(directory.onCreateTeam?.({ name: 'Draft', templateOrigin: 'blank', coordinatorProfileId: profile.id })).rejects.toThrow(zh.operationFailed)
      await expect(directory.onCreateTeam?.({ name: 'Draft', templateOrigin: 'document', coordinatorProfileId: profile.id })).rejects.toThrow(zh.operationFailed)
      await expect(directory.onArchiveProfile(profile.id)).rejects.toThrow(zh.operationFailed)
      await expect(directory.onUpdateProfile(profile.id, { name: 'Edit' })).rejects.toThrow(zh.operationFailed)
      await expect(directory.onSaveMemory?.({ kind: 'profile', profileId: profile.id }, 'Memory')).rejects.toThrow(zh.operationFailed)
      await expect(directory.onUpdateSeat?.(seat.id, { duty: 'Updated duty' })).rejects.toThrow(zh.operationFailed)
    } finally { await ctx.fiber.dispose() }
  })

  it('exposes discussions only with the full capability and does not provision on registration', async () => {
    const list = vi.fn().mockResolvedValue([])
    const provision = vi.fn(async () => ({ coordinatorSessionId: SessionId('lead') }))
    const unavailable = async () => { throw new Error('Not invoked by registration') }
    const complete: TeamDiscussionOps = { listDiscussions: list, provisionTeam: provision,
      createDiscussion: unavailable, scheduleRound: unavailable, startRound: unavailable,
      getRound: unavailable, cancelRound: unavailable, queryPublicTranscript: unavailable }
    const active = injection(complete)
    const partial = injection({ listDiscussions: list })
    try {
      expect(active.directory.discussionOps).toBeDefined()
      expect(partial.directory.discussionOps).toBeUndefined()
      expect(provision).not.toHaveBeenCalled()
      expect(await active.directory.discussionOps?.listDiscussions(team.id)).toEqual([])
      expect(list).toHaveBeenCalledExactlyOnceWith(team.id)
    } finally { await active.ctx.fiber.dispose(); await partial.ctx.fiber.dispose() }
  })

  it('sends the explicit second cancellation argument through raw RPC', async () => {
    const unused = async () => { throw new Error('Not called') }
    const cancelRound = vi.fn(async (...args: readonly unknown[]) => {
      if (args.length !== 2) throw new Error('cancelRound requires exactly two arguments')
      return { ok: true, value: undefined }
    })
    const { ctx, directory } = injection({}, { assistants: { listDiscussions: unused, createDiscussion: unused,
      provisionTeam: unused, scheduleRound: unused, startRound: unused, getRound: unused,
      cancelRound, queryPublicTranscript: unused } })
    try {
      expect(directory.discussionOps).toBeDefined()
      await directory.discussionOps?.cancelRound(GroupRoundId('round'))
      expect(cancelRound.mock.calls[0]).toEqual(['round', undefined])
    } finally { await ctx.fiber.dispose() }
  })

  it('supplies every optional wire position for profile save and new-topic creation', async () => {
    const updateProfile = vi.fn(async (...args: readonly unknown[]) => {
      if (args.length !== 3) throw new Error('updateProfile requires exactly three arguments')
      return { ok: true, value: profile }
    })
    const start = vi.fn(async (...args: readonly unknown[]) => {
      if (args.length !== 2) throw new Error('startNewTopic requires exactly two arguments')
      return { ok: true, value: { rootSessionId: SessionId('new-topic') } }
    })
    const { ctx, directory, startNewTopic } = injection({}, { assistants: { updateProfile, startNewTopic: start } })
    try {
      await directory.onUpdateProfile(profile.id, { avatar: '🌊' })
      expect(updateProfile.mock.calls[0]).toEqual([profile.id, { avatar: '🌊' }, undefined])
      expect(startNewTopic).toBeDefined()
      await startNewTopic?.(profile.id)
      expect(start.mock.calls[0]).toEqual([profile.id, undefined])
    } finally { await ctx.fiber.dispose() }
  })

  it('forwards avatars on profile, blank team, template team and team update payloads', async () => {
    const createProfile = vi.fn().mockResolvedValue(profile)
    const createTeam = vi.fn().mockResolvedValue(team)
    const template = vi.fn().mockResolvedValue({ team, seats: [] })
    const updateTeam = vi.fn().mockResolvedValue(team)
    const { ctx, directory } = injection({ createProfile, createTeam, createTeamFromTemplate: template, updateTeam })
    try {
      await directory.onCreateProfile({ name: 'Assistant', responsibility: 'Assist', avatar: '🐳' })
      expect(createProfile.mock.calls[0]?.[0]).toMatchObject({ avatar: '🐳' })
      await directory.onCreateTeam?.({ name: 'Blank', templateOrigin: 'blank', coordinatorProfileId: profile.id, avatar: '🌿' })
      expect(template.mock.calls[0]).toEqual(['blank', expect.objectContaining({ avatar: '🌿' })])
      expect(createTeam).not.toHaveBeenCalled()
      await directory.onCreateTeam?.({ name: 'Document', templateOrigin: 'document', coordinatorProfileId: profile.id, avatar: '📚' })
      expect(template.mock.calls[1]?.[1]).toMatchObject({ avatar: '📚' })
      await directory.onSaveTeam?.(team.id, team.revision, { avatar: '🌊' })
      expect(updateTeam.mock.calls[0]?.[2]).toMatchObject({ avatar: '🌊' })
    } finally { await ctx.fiber.dispose() }
  })
})
