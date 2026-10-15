import { describe, expect, it } from 'vitest'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness } from './harness.ts'
import { AssistantProfileId, MemoryEntryId, RevisionConflictError, MEMORY_TEXT_MAX_LENGTH } from '../src/index.ts'

describe('Scoped Memory Service (S17)', { timeout: 30_000 }, () => {
  it('saves profile-scoped and team-scoped memory with source attribution and revision 1', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({
        name: 'Researcher',
        responsibility: 'Conduct research',
      })
      const mem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Prefers concise Markdown summaries', {
        sourceSessionId: SessionId('sess-1'),
        sourceEventSeq: 42,
        author: 'user',
      })

      expect(mem.id).toBeDefined()
      expect(mem.scope).toEqual({ kind: 'profile', profileId: p.id })
      expect(mem.text).toBe('Prefers concise Markdown summaries')
      expect(mem.sourceSessionId).toBe(SessionId('sess-1'))
      expect(mem.sourceEventSeq).toBe(42)
      expect(mem.author).toBe('user')
      expect(mem.revision).toBe(1)
      expect(mem.removedAt).toBeUndefined()
      expect(mem.createdAt).toBeGreaterThan(0)

      // Team scope
      const team = await h.assistants.createTeam({
        name: 'Writing Squad',
        description: 'Produce documents',
        coordinatorProfileId: p.id,
      })
      const teamMem = await h.assistants.saveMemory({ kind: 'team', teamId: team.id }, 'Document formatting uses AP style')
      expect(teamMem.scope).toEqual({ kind: 'team', teamId: team.id })
      expect(teamMem.text).toBe('Document formatting uses AP style')
      expect(teamMem.revision).toBe(1)
    } finally {
      await h.dispose()
    }
  })

  it('rejects empty memory text', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Bot', responsibility: 'Help' })
      await expect(h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, '   ')).rejects.toThrow('Memory text cannot be empty')
    } finally {
      await h.dispose()
    }
  })

  it('updates memory text with CAS revision validation and rejects concurrent revision conflicts', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Bot', responsibility: 'Help' })
      const mem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Initial preference')

      const updated = await h.assistants.updateMemory(mem.id, 1, 'Updated preference')
      expect(updated.text).toBe('Updated preference')
      expect(updated.revision).toBe(2)

      // Stale revision rejection
      await expect(h.assistants.updateMemory(mem.id, 1, 'Conflict attempt')).rejects.toThrow(RevisionConflictError)
    } finally {
      await h.dispose()
    }
  })

  it('removes memory via soft-deletion tombstone and excludes it from future queries', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Bot', responsibility: 'Help' })
      const mem1 = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Fact 1')
      const mem2 = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Fact 2')

      const removed = await h.assistants.removeMemory(mem1.id, 1)
      expect(removed.removedAt).toBeDefined()
      expect(removed.revision).toBe(2)

      // Active list excludes removed
      const active = await h.assistants.listMemory({ kind: 'profile', profileId: p.id })
      expect(active).toHaveLength(1)
      expect(active[0]!.id).toBe(mem2.id)

      // Explicit includeRemoved lists all
      const all = await h.assistants.listMemory({ kind: 'profile', profileId: p.id }, { includeRemoved: true })
      expect(all).toHaveLength(2)
      expect(all.some(m => m.id === mem1.id && m.removedAt !== undefined)).toBe(true)

      // Recall excludes removed
      const recalled = await h.assistants.recallMemory({ kind: 'profile', profileId: p.id }, 'Fact 1')
      expect(recalled).toHaveLength(0)

      const recalled2 = await h.assistants.recallMemory({ kind: 'profile', profileId: p.id }, 'Fact 2')
      expect(recalled2).toHaveLength(1)
      expect(recalled2[0]!.id).toBe(mem2.id)
    } finally {
      await h.dispose()
    }
  })

  it('strictly isolates memory across profile and team scopes', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p1 = await h.assistants.createProfile({ name: 'Alice', responsibility: 'Resp 1' })
      const p2 = await h.assistants.createProfile({ name: 'Bob', responsibility: 'Resp 2' })
      const t1 = await h.assistants.createTeam({ name: 'Team Alpha', description: 'Duty 1', coordinatorProfileId: p1.id })

      await h.assistants.saveMemory({ kind: 'profile', profileId: p1.id }, 'Alice secret memory')
      await h.assistants.saveMemory({ kind: 'profile', profileId: p2.id }, 'Bob memory')
      await h.assistants.saveMemory({ kind: 'team', teamId: t1.id }, 'Team Alpha shared standard')

      const aliceMems = await h.assistants.listMemory({ kind: 'profile', profileId: p1.id })
      expect(aliceMems).toHaveLength(1)
      expect(aliceMems[0]!.text).toBe('Alice secret memory')

      const bobMems = await h.assistants.listMemory({ kind: 'profile', profileId: p2.id })
      expect(bobMems).toHaveLength(1)
      expect(bobMems[0]!.text).toBe('Bob memory')

      const teamMems = await h.assistants.listMemory({ kind: 'team', teamId: t1.id })
      expect(teamMems).toHaveLength(1)
      expect(teamMems[0]!.text).toBe('Team Alpha shared standard')
    } finally {
      await h.dispose()
    }
  })

  it('promotes team-scoped memory to profile only with explicit owner authorization', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Lead', responsibility: 'Coordinate' })
      const team = await h.assistants.createTeam({ name: 'Team Bravo', description: 'Testing', coordinatorProfileId: p.id })
      const teamMem = await h.assistants.saveMemory({ kind: 'team', teamId: team.id }, 'Key team observation', {
        sourceSessionId: SessionId('team-lead'),
      })

      // Unauthorized promotion must fail
      await expect(h.assistants.promoteTeamMemoryToProfile(teamMem.id, p.id, false)).rejects.toThrow('Owner authorization required')

      // Authorized promotion succeeds
      const promoted = await h.assistants.promoteTeamMemoryToProfile(teamMem.id, p.id, true)
      expect(promoted.scope).toEqual({ kind: 'profile', profileId: p.id })
      expect(promoted.text).toBe('Key team observation')
      expect(promoted.author).toBe(`promoted-from-team:${team.id}`)
      expect(promoted.sourceSessionId).toBe(SessionId('team-lead'))

      // Profile now lists the promoted memory
      const profileMems = await h.assistants.listMemory({ kind: 'profile', profileId: p.id })
      expect(profileMems.some(m => m.id === promoted.id)).toBe(true)
    } finally {
      await h.dispose()
    }
  })

  it('persists scoped memories and tombstones across cold catalog reload', async () => {
    const h1 = await setupAssistantHarness([], {}, { withCatalog: true })
    const storageRoot = h1.storageRoot
    let profileId: AssistantProfileId
    let mem1Id: MemoryEntryId
    let mem2Id: MemoryEntryId

    try {
      const p = await h1.assistants.createProfile({ name: 'Persistent', responsibility: 'Survive restarts' })
      profileId = p.id
      const mem1 = await h1.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Persistent memory 1')
      const mem2 = await h1.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Persistent memory 2')
      mem1Id = mem1.id
      mem2Id = mem2.id

      // Remove mem2
      await h1.assistants.removeMemory(mem2.id, 1)
    } finally {
      await h1.dispose(true)
    }

    // Cold reload
    const h2 = await setupAssistantHarness([], {}, { withCatalog: true, storageRoot })
    try {
      const active = await h2.assistants.listMemory({ kind: 'profile', profileId: profileId! })
      expect(active).toHaveLength(1)
      expect(active[0]!.id).toBe(mem1Id!)
      expect(active[0]!.text).toBe('Persistent memory 1')

      const all = await h2.assistants.listMemory({ kind: 'profile', profileId: profileId! }, { includeRemoved: true })
      expect(all).toHaveLength(2)
      const removedMem = all.find(m => m.id === mem2Id!)
      expect(removedMem).toBeDefined()
      expect(removedMem!.removedAt).toBeDefined()
      expect(removedMem!.revision).toBe(2)
    } finally {
      await h2.dispose()
    }
  })

  it('enforces bounded maximum memory text length', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Writer', responsibility: 'Write' })
      const oversizedText = 'a'.repeat(MEMORY_TEXT_MAX_LENGTH + 1)
      await expect(h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, oversizedText)).rejects.toThrow(
        `Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`,
      )

      const validMem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'a'.repeat(MEMORY_TEXT_MAX_LENGTH))
      expect(validMem.text.length).toBe(MEMORY_TEXT_MAX_LENGTH)

      await expect(h.assistants.updateMemory(validMem.id, validMem.revision, oversizedText)).rejects.toThrow(
        `Memory text exceeds maximum length of ${MEMORY_TEXT_MAX_LENGTH} characters`,
      )
    } finally {
      await h.dispose()
    }
  })

  it('archives and unarchives memory with CAS revision validation', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Historian', responsibility: 'History' })
      const mem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Historical fact')
      expect(mem.archivedAt).toBeUndefined()

      // Stale revision CAS rejection
      await expect(h.assistants.archiveMemory(mem.id, mem.revision + 99)).rejects.toThrow(RevisionConflictError)

      // Successful archive
      const archived = await h.assistants.archiveMemory(mem.id, mem.revision)
      expect(archived.archivedAt).toBeDefined()
      expect(archived.revision).toBe(2)

      // Excluded from default list
      const activeList = await h.assistants.listMemory({ kind: 'profile', profileId: p.id })
      expect(activeList.some(m => m.id === mem.id)).toBe(false)

      // Included when includeArchived: true
      const fullList = await h.assistants.listMemory({ kind: 'profile', profileId: p.id }, { includeArchived: true })
      expect(fullList.some(m => m.id === mem.id && m.archivedAt !== undefined)).toBe(true)

      // Unarchive
      const unarchived = await h.assistants.unarchiveMemory(mem.id, archived.revision)
      expect(unarchived.archivedAt).toBeUndefined()
      expect(unarchived.revision).toBe(3)

      const restoredList = await h.assistants.listMemory({ kind: 'profile', profileId: p.id })
      expect(restoredList.some(m => m.id === mem.id)).toBe(true)
    } finally {
      await h.dispose()
    }
  })

  it('grants and revokes profile memory access to teams with CAS revision check', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Expert', responsibility: 'Provide domain knowledge' })
      const t1 = await h.assistants.createTeam({ name: 'Alpha', coordinatorProfileId: p.id })
      const mem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Domain insight')
      expect(mem.grants).toBeUndefined()

      // Grant to t1
      const granted = await h.assistants.grantMemory(mem.id, t1.id, mem.revision)
      expect(granted.grants).toEqual([t1.id])
      expect(granted.revision).toBe(2)

      // CAS conflict on stale rev
      await expect(h.assistants.grantMemory(mem.id, t1.id, 1)).rejects.toThrow(RevisionConflictError)

      // Idempotent grant on current rev
      const same = await h.assistants.grantMemory(mem.id, t1.id, granted.revision)
      expect(same.grants).toEqual([t1.id])

      // Revoke grant
      const revoked = await h.assistants.revokeMemoryGrant(mem.id, t1.id, granted.revision)
      expect(revoked.grants).toBeUndefined()
      expect(revoked.revision).toBe(3)
    } finally {
      await h.dispose()
    }
  })

  it('preserves strict memory isolation across 1 profile in private conversation and 2 teams', async () => {
    const h = await setupAssistantHarness()
    try {
      const p = await h.assistants.createProfile({ name: 'Alice', responsibility: 'Consulting' })

      // Private conversation
      await h.assistants.createConversation(p.id, h.lead.id)
      const privateMem = await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'ALICE_PRIVATE_NOTE')

      // Team 1
      const t1 = await h.assistants.createTeam({ name: 'Team Alpha', coordinatorProfileId: p.id })
      const s1 = await h.assistants.createSeat({ teamId: t1.id, profileId: p.id, role: 'teammate', name: 'worker1', duty: 'Work 1' })
      const team1Session = SessionId('team-1-session')
      await h.assistants.bindSeatSession(s1.id, team1Session)
      await h.assistants.saveMemory({ kind: 'team', teamId: t1.id }, 'TEAM_ALPHA_SHARED')

      // Team 2
      const t2 = await h.assistants.createTeam({ name: 'Team Beta', coordinatorProfileId: p.id })
      const s2 = await h.assistants.createSeat({ teamId: t2.id, profileId: p.id, role: 'teammate', name: 'worker2', duty: 'Work 2' })
      const team2Session = SessionId('team-2-session')
      await h.assistants.bindSeatSession(s2.id, team2Session)
      await h.assistants.saveMemory({ kind: 'team', teamId: t2.id }, 'TEAM_BETA_SHARED')

      // 1. Private conversation prompt: has ALICE_PRIVATE_NOTE, no team notes
      const privPrompt = await h.lead.ctx.systemPrompt.assemble(assembleContextFor(h.lead))
      const privText = privPrompt.sections.find(x => x.name === `assistant:memory:${h.lead.id}`)?.text ?? ''
      expect(privText).toContain('ALICE_PRIVATE_NOTE')
      expect(privText).not.toContain('TEAM_ALPHA_SHARED')
      expect(privText).not.toContain('TEAM_BETA_SHARED')

      // Before grant: Team 1 has TEAM_ALPHA_SHARED only, NOT ALICE_PRIVATE_NOTE and NOT TEAM_BETA_SHARED
      const team1Mems = h.assistants.listMemorySync({ kind: 'team', teamId: t1.id })
      let grantedT1 = h.assistants.listGrantedProfileMemoriesSync(t1.id, p.id)
      expect(team1Mems.map(m => m.text)).toEqual(['TEAM_ALPHA_SHARED'])
      expect(grantedT1).toHaveLength(0)

      // Grant ALICE_PRIVATE_NOTE to Team 1 only
      const grantedEntry = await h.assistants.grantMemory(privateMem.id, t1.id, privateMem.revision)
      expect(grantedEntry.grants).toEqual([t1.id])

      // After grant: Team 1 sees ALICE_PRIVATE_NOTE as granted memory
      grantedT1 = h.assistants.listGrantedProfileMemoriesSync(t1.id, p.id)
      expect(grantedT1.map(m => m.text)).toEqual(['ALICE_PRIVATE_NOTE'])

      // Team 2 NEVER receives ALICE_PRIVATE_NOTE because it was granted only to Team 1
      const grantedT2 = h.assistants.listGrantedProfileMemoriesSync(t2.id, p.id)
      expect(grantedT2).toHaveLength(0)

      // Revoke grant from Team 1
      await h.assistants.revokeMemoryGrant(privateMem.id, t1.id, grantedEntry.revision)
      const afterRevokeT1 = h.assistants.listGrantedProfileMemoriesSync(t1.id, p.id)
      expect(afterRevokeT1).toHaveLength(0)
    } finally {
      await h.dispose()
    }
  })
})
