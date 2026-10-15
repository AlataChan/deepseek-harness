import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { setupAssistantHarness } from './harness.ts'
import { AssistantProfileId } from '../src/types.ts'

describe('Assistant Private Conversations and Model Selection Checkpointing (S7)', () => {
  it('allocates session over official sessionController.create path', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Coding Assistant',
        responsibility: 'Help with TypeScript code',
        defaultModel: { provider: 'mock', model: 'mock-default' },
      })

      const conv = await harness.assistants.createConversation(profile.id, {
        title: 'Initial Topic',
      })

      expect(conv.id).toBeDefined()
      expect(conv.profileId).toBe(profile.id)
      expect(conv.rootSessionId).toBeDefined()
      expect(conv.modelOverride).toBeUndefined()

      // Bound in memory and catalog
      expect(harness.assistants.isAssistantBound(conv.rootSessionId)).toBe(true)
      const found = await harness.assistants.getConversation(conv.id)
      expect(found?.rootSessionId).toBe(conv.rootSessionId)

      // Effective route inherits from profile default
      const effective = harness.assistants.resolveEffectiveRoute(conv.rootSessionId)
      expect(effective).toBeDefined()
      expect(effective?.route.model).toBe('mock-default')
      expect(effective?.source).toBe('profile')
    } finally {
      await harness.dispose()
    }
  })

  it('supports startNewTopic creating fresh root session without shared history', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Researcher',
        responsibility: 'Analyze documents',
        defaultModel: { provider: 'mock', model: 'mock-v1' },
      })

      const topic1 = await harness.assistants.createConversation(profile.id, { title: 'Topic 1' })
      const topic2 = await harness.assistants.startNewTopic(profile.id, { title: 'Topic 2' })

      expect(topic1.rootSessionId).not.toBe(topic2.rootSessionId)
      expect(topic1.profileId).toBe(profile.id)
      expect(topic2.profileId).toBe(profile.id)

      // Both conversations belong to the same profile
      const convs = await harness.assistants.listConversations(profile.id)
      expect(convs).toHaveLength(2)
      expect(convs.map(c => c.id)).toContain(topic1.id)
      expect(convs.map(c => c.id)).toContain(topic2.id)
    } finally {
      await harness.dispose()
    }
  })

  it('manages explicit conversation model override vs profile inheritance', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Writer',
        responsibility: 'Draft articles',
        defaultModel: { provider: 'mock', model: 'model-profile-a' },
      })

      const conv = await harness.assistants.createConversation(profile.id)
      expect(harness.assistants.resolveEffectiveRoute(conv.rootSessionId)?.route.model).toBe('model-profile-a')
      expect(harness.assistants.resolveEffectiveRoute(conv.rootSessionId)?.source).toBe('profile')

      // Set explicit override
      const overrideModel: ModelSelection = { provider: 'mock', model: 'model-override-b' }
      const updated = await harness.assistants.setConversationModelOverride(conv.id, overrideModel)
      expect(updated.modelOverride).toEqual(overrideModel)

      const effectiveOverridden = harness.assistants.resolveEffectiveRoute(conv.rootSessionId)
      expect(effectiveOverridden?.route.model).toBe('model-override-b')
      expect(effectiveOverridden?.source).toBe('conversation')

      // Changing profile default does not overwrite conversation explicit override
      await harness.assistants.updateProfile(profile.id, {
        defaultModel: { provider: 'mock', model: 'model-profile-c' },
      })
      expect(harness.assistants.resolveEffectiveRoute(conv.rootSessionId)?.route.model).toBe('model-override-b')
    } finally {
      await harness.dispose()
    }
  })

  it('clear-override commits inherit plus replay checkpoint atomically', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Analyst',
        responsibility: 'Perform analysis',
        defaultModel: { provider: 'mock', model: 'model-profile-base' },
      })

      const conv = await harness.assistants.createConversation(profile.id)
      await harness.assistants.setConversationModelOverride(conv.id, { provider: 'mock', model: 'model-override-x' }, 5)

      // Clear override
      const cleared = await harness.assistants.clearConversationModelOverride(conv.id, 10)
      expect(cleared.modelOverride).toBeUndefined()
      expect(cleared.modelCheckpoint).toBe(10)

      // Effective route returns to profile default
      const effective = harness.assistants.resolveEffectiveRoute(conv.rootSessionId)
      expect(effective?.route.model).toBe('model-profile-base')
      expect(effective?.source).toBe('profile')

      // Subsequent profile change propagates to this cleared conversation
      await harness.assistants.updateProfile(profile.id, {
        defaultModel: { provider: 'mock', model: 'model-profile-new' },
      })
      expect(harness.assistants.resolveEffectiveRoute(conv.rootSessionId)?.route.model).toBe('model-profile-new')
    } finally {
      await harness.dispose()
    }
  })

  it('live session/event listener tracks model/selection when newer than checkpoint', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Assistant',
        responsibility: 'General tasks',
        defaultModel: { provider: 'mock', model: 'model-profile' },
      })

      const conv = await harness.assistants.createConversation(profile.id)
      const liveSession = harness.ctx.sessions.get(conv.rootSessionId)
      expect(liveSession).toBeDefined()

      // Emit live model/selection event on the session
      liveSession!.append('model/selection', { provider: 'mock', model: 'model-from-event' })

      await expect.poll(() => harness.assistants.resolveEffectiveRoute(conv.rootSessionId)?.route.model,
        { timeout: 5000 }).toBe('model-from-event')

      const effective = harness.assistants.resolveEffectiveRoute(conv.rootSessionId)
      expect(effective?.route.model).toBe('model-from-event')
      expect(effective?.source).toBe('conversation')
    } finally {
      await harness.dispose()
    }
  })

  it('cold replay skips older selection events and accepts newer explicit selections', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Editor',
        responsibility: 'Review text',
        defaultModel: { provider: 'mock', model: 'model-default' },
      })

      const conv = await harness.assistants.createConversation(profile.id)
      const liveSession = harness.ctx.sessions.get(conv.rootSessionId)!

      // Append model/selection at seq 0
      liveSession.append('model/selection', { provider: 'mock', model: 'old-model' })
      await harness.ctx.sessionPersistence.flush()

      // User explicitly clears override at current seq
      await harness.assistants.clearConversationModelOverride(conv.id)

      // Seed from persistence: seq 0 is <= modelCheckpoint, so it must be SKIPPED
      const afterSkip = await harness.assistants.seedConversationFromPersistence(conv.id)
      expect(afterSkip.modelOverride).toBeUndefined()

      // Now append a newer model/selection at newer seq
      liveSession.append('model/selection', { provider: 'mock', model: 'newer-model' })
      await harness.ctx.sessionPersistence.flush()

      const lastSeq = liveSession.seq - 1
      expect(lastSeq).toBeGreaterThan(conv.modelCheckpoint ?? 0)

      // Seed from persistence accepts the newer selection
      const afterNewer = await harness.assistants.seedConversationFromPersistence(conv.id)
      expect(afterNewer.modelOverride?.model).toBe('newer-model')
    } finally {
      await harness.dispose()
    }
  })

  it('crash recovery after clear commit retains inherit across restart', async () => {
    const harness1 = await setupAssistantHarness([], {}, { withCatalog: true })
    const storageRoot = harness1.storageRoot
    let profileId: AssistantProfileId
    let convId: string
    let rootSessionId: SessionId

    try {
      const profile = await harness1.assistants.createProfile({
        name: 'Reporter',
        responsibility: 'Report findings',
        defaultModel: { provider: 'mock', model: 'model-init' },
      })
      profileId = profile.id

      const conv = await harness1.assistants.createConversation(profile.id)
      convId = conv.id
      rootSessionId = conv.rootSessionId

      // User sets override, then clears it with checkpoint
      await harness1.assistants.setConversationModelOverride(conv.id, { provider: 'mock', model: 'model-override-temp' }, 1)
      await harness1.assistants.clearConversationModelOverride(conv.id, 2)
    } finally {
      // Dispose harness1 but keep disk storage intact for restart simulation
      await harness1.dispose(true)
    }

    // Reopen second harness with the same storage root
    const harness2 = await setupAssistantHarness([], {}, { storageRoot, withCatalog: true })
    try {
      const reloadedConv = await harness2.assistants.getConversation(convId as never)
      expect(reloadedConv).toBeDefined()
      expect(reloadedConv?.modelOverride).toBeUndefined()
      expect(reloadedConv?.modelCheckpoint).toBe(2)

      // Update inherited model on profile
      await harness2.assistants.updateProfile(profileId, {
        defaultModel: { provider: 'mock', model: 'model-updated-profile' },
      })

      // Reloaded conversation resolves to new profile model
      const effective = harness2.assistants.resolveEffectiveRoute(rootSessionId)
      expect(effective?.route.model).toBe('model-updated-profile')
      expect(effective?.source).toBe('profile')
    } finally {
      await harness2.dispose()
    }
  })

  it('archive blocks new submissions, topics, and filters permitted sessions', async () => {
    const harness = await setupAssistantHarness([], {}, { withCatalog: true })
    try {
      const profile = await harness.assistants.createProfile({
        name: 'Archived Assistant',
        responsibility: 'To be archived',
        defaultModel: { provider: 'mock', model: 'mock-model' },
      })

      const conv1 = await harness.assistants.createConversation(profile.id, { title: 'Active Conv' })
      const conv2 = await harness.assistants.createConversation(profile.id, { title: 'To Archive Conv' })

      // List permitted sessions before archiving
      let permitted = await harness.assistants.listPermittedSessions(profile.id)
      expect(permitted).toHaveLength(2)

      // Archive conv2
      await harness.assistants.archiveConversation(conv2.id)

      // Permitted sessions now excludes conv2
      permitted = await harness.assistants.listPermittedSessions(profile.id)
      expect(permitted).toEqual([conv1.rootSessionId])

      // Submitting prompt to archived conv2 is rejected
      await expect(
        harness.assistants.submitPrompt({
          requestId: 'req-arch-2' as SessionRequestId,
          sessionId: conv2.rootSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: 'hello' }],
        }),
      ).rejects.toThrow(/Cannot submit prompt to archived assistant conversation/)

      // Archive entire profile
      await harness.assistants.archiveProfile(profile.id)

      // Cannot create new conversation or start new topic on archived profile
      await expect(
        harness.assistants.createConversation(profile.id),
      ).rejects.toThrow(/Cannot create conversation for archived assistant profile/)
      await expect(
        harness.assistants.startNewTopic(profile.id),
      ).rejects.toThrow(/Cannot create conversation for archived assistant profile/)

      // Submitting prompt to conv1 of archived profile is rejected
      await expect(
        harness.assistants.submitPrompt({
          requestId: 'req-arch-1' as SessionRequestId,
          sessionId: conv1.rootSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: 'hello' }],
        }),
      ).rejects.toThrow(/Cannot submit prompt to archived assistant profile/)

      // Permitted sessions now empty for archived profile
      permitted = await harness.assistants.listPermittedSessions(profile.id)
      expect(permitted).toHaveLength(0)

      // But includeArchived shows all
      const allPermitted = await harness.assistants.listPermittedSessions(profile.id, true)
      expect(allPermitted).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })
})
