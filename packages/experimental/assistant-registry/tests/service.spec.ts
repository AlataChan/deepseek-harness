import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'

describe('AssistantService & Test Harness', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('mounts real dependencies including persistence, agent loop, subagents, and session controller', async () => {
    harness = await setupAssistantHarness()
    const { ctx, assistants, lead } = harness

    expect(ctx.get('assistants')).toBeDefined()
    expect(ctx.get('sessionController')).toBeDefined()
    expect(lead.session.id).toBe(SessionId('lead'))

    // Verify basic profile CRUD
    const profile = await assistants.createProfile({
      name: 'Code Reviewer',
      responsibility: 'Reviews pull requests and enforces standards',
      defaultModel: { provider: 'mock', model: 'mock-deepseek' },
    })
    expect(profile.name).toBe('Code Reviewer')
    expect(profile.revision).toBe(1)
    expect(profile.archivedAt).toBeUndefined()

    const retrieved = await assistants.getProfile(profile.id)
    expect(retrieved).toEqual(profile)

    const updated = await assistants.updateProfile(profile.id, {
      responsibility: 'Reviews PRs and suggests clean refactors',
    })
    expect(updated.revision).toBe(2)
    expect(updated.responsibility).toBe('Reviews PRs and suggests clean refactors')

    // Verify conversation binding
    const conv = await assistants.createConversation(profile.id, SessionId('lead'), {
      title: 'Review Task 1',
    })
    expect(conv.profileId).toBe(profile.id)
    expect(conv.rootSessionId).toBe(SessionId('lead'))

    const foundConv = await assistants.getConversationBySession(SessionId('lead'))
    expect(foundConv?.id).toBe(conv.id)

    // Archive profile
    await assistants.archiveProfile(profile.id)
    const archived = await assistants.getProfile(profile.id)
    expect(archived?.archivedAt).toBeDefined()

    const activeProfiles = await assistants.listProfiles(false)
    expect(activeProfiles.find(p => p.id === profile.id)).toBeUndefined()

    const allProfiles = await assistants.listProfiles(true)
    expect(allProfiles.find(p => p.id === profile.id)).toBeDefined()
  })
})
