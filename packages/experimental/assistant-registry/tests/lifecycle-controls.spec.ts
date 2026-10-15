import { describe, expect, it, vi } from 'vitest'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'

describe('Assistant lifecycle controls', () => {
  it('unbinds a blank Session durably and rejects unbinding after a real turn', async () => {
    const h = await setupAssistantHarness([textResponse('Done')])
    try {
      const p = await h.assistants.createProfile({ name: 'Writer', responsibility: 'Write' })
      const c = await h.assistants.createConversation(p.id)
      await h.assistants.clearConversationBinding(c.rootSessionId)
      expect(await h.assistants.getConversationBySession(c.rootSessionId)).toBeUndefined()
      expect(h.assistants.catalog?.getConversation(c.id)).toBeUndefined()
      const next = await h.assistants.createConversation(p.id, { rootSessionId: c.rootSessionId })
      await h.assistants.submitPrompt({ sessionId: next.rootSessionId,
        mode: 'queue', requestId: 'lifecycle-turn' as SessionRequestId, content: [{ type: 'text', text: 'Hello' }] })
      await expect(h.assistants.clearConversationBinding(next.rootSessionId)).rejects.toThrow()
      expect(await h.assistants.getConversationBySession(next.rootSessionId)).toBeDefined()
    } finally { await h.dispose() }
  })

  it('deletes reusable profile configuration and memory while preserving conversation history bindings', async () => {
    const h = await setupAssistantHarness([])
    try {
      const p = await h.assistants.createProfile({ name: 'Writer', responsibility: 'Write', instructions: 'Private instruction' })
      const c = await h.assistants.createConversation(p.id)
      await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Private memory')
      await expect(h.assistants.deleteProfile(p.id, p.revision + 1)).rejects.toThrow()
      await h.assistants.deleteProfile(p.id, p.revision)
      expect(await h.assistants.listProfiles(true)).toEqual([])
      expect((await h.assistants.getProfile(p.id))?.instructions).toBeUndefined()
      expect(await h.assistants.listMemory({ kind: 'profile', profileId: p.id }, { includeRemoved: true, includeArchived: true })).toEqual([])
      expect(await h.assistants.getConversationBySession(c.rootSessionId)).toBeDefined()
      await expect(h.assistants.unarchiveProfile(p.id)).rejects.toThrow()
      await expect(h.assistants.createConversation(p.id)).rejects.toThrow()
    } finally { await h.dispose() }
  })

  it('requires team deletion before deleting referenced profiles and reserves deleted identifiers', async () => {
    const h = await setupAssistantHarness([])
    try {
      const p = await h.assistants.createProfile({ id: 'reserved', name: 'Coordinator', responsibility: 'Coordinate' })
      const team = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id })
      await expect(h.assistants.deleteProfile(p.id, p.revision)).rejects.toThrow(/referenced/i)
      await h.assistants.deleteTeam(team.id, team.revision)
      expect(await h.assistants.listTeams(true)).toEqual([])
      await expect(h.assistants.updateTeam(team.id, team.revision, { name: 'Revive' })).rejects.toThrow()
      await h.assistants.deleteProfile(p.id, p.revision)
      await expect(h.assistants.createProfile({ id: 'reserved', name: 'Reuse', responsibility: 'Reuse' })).rejects.toThrow()
    } finally { await h.dispose() }
  })
})

describe('Lifecycle execution and recovery controls', () => {
  it('does not send assistant role or memory after cancelling an unused selection', async () => {
    const h = await setupAssistantHarness([textResponse('Ordinary reply')])
    try {
      const p = await h.assistants.createProfile({ name: 'Secret identity', responsibility: 'Secret duty' })
      await h.assistants.createConversation(p.id, h.lead.id)
      await h.assistants.saveMemory({ kind: 'profile', profileId: p.id }, 'Secret profile memory')
      await h.assistants.clearConversationBinding(h.lead.id)
      await h.controller.prompt({ sessionId: h.lead.id, mode: 'queue', requestId: 'ordinary-turn' as SessionRequestId,
        content: [{ type: 'text', text: 'Hello' }] }, new AbortController().signal)
      await h.lead.whenIdle()
      const observation = await h.ctx.sessionQuery.observeSession(h.lead.id)
      try {
        const systems = observation.events.filter(e => e.type === 'system/message')
        expect(systems.length).toBeGreaterThan(0)
        const text = JSON.stringify(systems)
        expect(text).not.toContain('Secret identity')
        expect(text).not.toContain('Secret duty')
        expect(text).not.toContain('Secret profile memory')
        expect(h.adapter.requests).toHaveLength(1)
      } finally { observation[Symbol.dispose]() }
    } finally { await h.dispose() }
  })

  it('retains irreversible deletion and unbinding across a cold catalog reopen', async () => {
    const h = await setupAssistantHarness([])
    let closed = false
    let restarted: Awaited<ReturnType<typeof setupAssistantHarness>> | undefined
    try {
      const p = await h.assistants.createProfile({ name: 'Deleted identity', responsibility: 'Write' })
      const created = await h.assistants.createTeamFromTemplate('blank', { name: 'Deleted team', coordinatorProfileId: p.id })
      const team = (await h.assistants.getTeam(created.team.id))!
      const c = await h.assistants.createConversation(p.id)
      await h.assistants.clearConversationBinding(c.rootSessionId)
      await h.assistants.deleteTeam(team.id, team.revision)
      await h.assistants.deleteProfile(p.id, p.revision)
      await h.dispose(true)
      closed = true
      restarted = await setupAssistantHarness([], {}, { storageRoot: h.storageRoot })
      expect(await restarted.assistants.listProfiles(true)).toEqual([])
      expect(await restarted.assistants.listTeams(true)).toEqual([])
      expect(await restarted.assistants.getConversationBySession(c.rootSessionId)).toBeUndefined()
      await expect(restarted.assistants.unarchiveProfile(p.id)).rejects.toThrow()
      await expect(restarted.assistants.catalog!.createTeam({ id: team.id, name: 'Reuse', coordinatorProfileId: p.id })).rejects.toThrow()
    } finally {
      if (!closed) await h.dispose()
      await restarted?.dispose()
      const { rmSync } = await import('node:fs')
      rmSync(h.storageRoot, { recursive: true, force: true })
    }
  })
})


describe('Deletion admission', () => {
  it('refuses deletion while a real provider is running and preserves its configuration', async () => {
    const h = await setupAssistantHarness(['hang'])
    try {
      const p = await h.assistants.createProfile({ name: 'Busy', responsibility: 'Work' })
      await h.assistants.createConversation(p.id, h.lead.id)
      h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Keep working' }], source: { kind: 'user' } }))
      await vi.waitFor(() => { expect(h.adapter.requests).toHaveLength(1) })
      await expect(h.assistants.deleteProfile(p.id, p.revision)).rejects.toThrow(/running/i)
      expect((await h.assistants.getProfile(p.id))?.deletedAt).toBeUndefined()
      expect(await h.assistants.listProfiles()).toHaveLength(1)
    } finally {
      h.lead.cancel({ kind: 'user' })
      await h.lead.whenIdle()
      await h.dispose()
    }
  })

  it('rejects the direct Agent path after deletion without another provider request', async () => {
    const h = await setupAssistantHarness([textResponse('Original reply')])
    try {
      const p = await h.assistants.createProfile({ name: 'Historical', responsibility: 'Work' })
      await h.assistants.createConversation(p.id, h.lead.id)
      h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }))
      await h.lead.whenIdle()
      const before = await h.ctx.sessionQuery.observeSession(h.lead.id)
      const originalText = JSON.stringify(before.events.filter(e => e.type === 'system/message' || e.type === 'assistant/message'))
      before[Symbol.dispose]()
      await h.assistants.deleteProfile(p.id, p.revision)
      h.lead.followup(createUserMessage({ content: [{ type: 'text', text: 'Run again' }], source: { kind: 'user' } }))
      await h.lead.whenIdle()
      expect(h.adapter.requests).toHaveLength(1)
      const after = await h.ctx.sessionQuery.observeSession(h.lead.id)
      try {
        expect(JSON.stringify(after.events.filter(e => e.type === 'system/message' || e.type === 'assistant/message'))).toBe(originalText)
      } finally { after[Symbol.dispose]() }
    } finally { await h.dispose() }
  })
})
