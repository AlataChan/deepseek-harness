import { describe, expect, it } from 'vitest'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness } from './harness.ts'
import type { AssistantProfileId } from '../src/types.ts'

function extractMessageText(message: { content?: unknown } | undefined): string {
  if (!message || message.content === undefined || message.content === null) return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map(part => (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

describe('Stage B1 Acceptance: Persistent Assistant End-to-End Cycle', () => {
  it('executes full create -> converse -> change model/role -> restart -> reopen lifecycle', async () => {
    // Phase 1: Initial Harness Setup
    const script = [
      textResponse('Response from base profile model'),
      textResponse('Response from conversation override model'),
      textResponse('Response from updated instructions'),
    ]
    const adapter1 = new MockAdapter([...script])
    const harness1 = await setupAssistantHarness(adapter1, {}, { withCatalog: true })
    const storageRoot = harness1.storageRoot

    let profileId: AssistantProfileId
    let rootSessionId: SessionId
    let convId: string

    try {
      // 1. Create assistant profile with dedicated role and default model
      const profile = await harness1.assistants.createProfile({
        name: 'Technical Strategist',
        responsibility: 'Lead software architecture and TypeScript standards',
        instructions: 'Deliver structured, rigorous, and type-safe guidance.',
        defaultModel: { provider: 'mock', model: 'mock-base-profile' },
      })
      profileId = profile.id

      // 2. Assert application default model is untouched across all surfaces
      const appDefaultModel = harness1.ctx.agentDefaultModel
      expect(appDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })

      // 3. Create private conversation over official create path
      const conv = await harness1.assistants.createConversation(profile.id, {
        title: 'Architecture Review',
      })
      convId = conv.id
      rootSessionId = conv.rootSessionId

      expect(harness1.assistants.isAssistantBound(rootSessionId)).toBe(true)
      expect(conv.modelOverride).toBeUndefined()

      // 4. Converse: Submit prompt via assistant submission operation
      await harness1.assistants.submitPrompt({
        requestId: 'req-1' as SessionRequestId,
        sessionId: rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'How should we structure domain entities?' }],
      })
      const agentRes1 = await harness1.controller.resolveAgent(rootSessionId)
      if ('agent' in agentRes1) {
        await agentRes1.agent.whenIdle()
      }

      // Verify request 1 used base profile model
      expect(adapter1.requests).toHaveLength(1)
      expect(adapter1.requests[0]?.model).toBe('mock-base-profile')

      // Verify role input is injected into logged prompt / system message
      const systemText1 = extractMessageText(adapter1.requests[0]?.messages.find(m => m.role === 'system'))
      expect(systemText1).toContain('Lead software architecture and TypeScript standards')
      expect(systemText1).toContain('Deliver structured, rigorous, and type-safe guidance.')

      // App default model remains unchanged
      expect(appDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })

      // 5. Change model on conversation: explicit conversation override
      const overrideModel: ModelSelection = { provider: 'mock', model: 'mock-conversation-override' }
      await harness1.assistants.setConversationModelOverride(conv.id, overrideModel)

      // App default model remains unchanged
      expect(appDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })

      // Submit prompt 2
      await harness1.assistants.submitPrompt({
        requestId: 'req-2' as SessionRequestId,
        sessionId: rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'What about state machines?' }],
      })
      if ('agent' in agentRes1) {
        await agentRes1.agent.whenIdle()
      }

      // Verify request 2 used the explicit conversation override
      expect(adapter1.requests).toHaveLength(2)
      expect(adapter1.requests[1]?.model).toBe('mock-conversation-override')

      // 6. Change role instructions on profile
      await harness1.assistants.updateProfile(profile.id, {
        instructions: 'Focus strictly on atomic transitions and bounded contexts.',
      })

      // Submit prompt 3
      await harness1.assistants.submitPrompt({
        requestId: 'req-3' as SessionRequestId,
        sessionId: rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Give me examples.' }],
      })
      if ('agent' in agentRes1) {
        await agentRes1.agent.whenIdle()
      }

      // Verify request 3 has updated instructions
      expect(adapter1.requests).toHaveLength(3)
      const systemText3 = extractMessageText(adapter1.requests[2]?.messages.find(m => m.role === 'system'))
      expect(systemText3).toContain('Focus strictly on atomic transitions and bounded contexts.')

      // 7. Clear conversation override (commits inherit + checkpoint atomically)
      await harness1.assistants.clearConversationModelOverride(conv.id)
      const clearedEffective = harness1.assistants.resolveEffectiveRoute(rootSessionId)
      expect(clearedEffective?.source).toBe('profile')
      expect(clearedEffective?.route.model).toBe('mock-base-profile')

      // Flush session persistence before simulated crash/restart
      await harness1.ctx.sessionPersistence.flush()
    } finally {
      // Simulate crash/restart before sending the next inherited request
      await harness1.dispose(true)
    }

    // Phase 2: Restart & Cold Reopen
    const script2 = [
      textResponse('Response after restart with upgraded profile model'),
      textResponse('Response from fresh new topic'),
    ]
    const adapter2 = new MockAdapter([...script2])
    const harness2 = await setupAssistantHarness(
      adapter2,
      {},
      { storageRoot, withCatalog: true, leadSessionId: SessionId('lead-restarted') },
    )

    try {
      // Assert reloaded conversation retains cleared state (does not revive old override)
      const reloadedConv = await harness2.assistants.getConversation(convId as never)
      expect(reloadedConv).toBeDefined()
      expect(reloadedConv?.modelOverride).toBeUndefined()

      // Cold replay through seedConversationFromPersistence keeps cleared state
      const seeded = await harness2.assistants.seedConversationFromPersistence(convId as never)
      expect(seeded.modelOverride).toBeUndefined()

      // Change inherited model on profile after restart
      await harness2.assistants.updateProfile(profileId, {
        defaultModel: { provider: 'mock', model: 'mock-profile-upgraded' },
      })

      // Assert app default model is still unchanged
      expect(harness2.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })

      // Submit prompt 4 on resumed conversation
      await harness2.assistants.submitPrompt({
        requestId: 'req-4' as SessionRequestId,
        sessionId: rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Resuming after restart.' }],
      })
      const agentRes2 = await harness2.controller.resolveAgent(rootSessionId)
      if ('agent' in agentRes2) {
        await agentRes2.agent.whenIdle()
      }

      // Verify request 4 used the new inherited model
      expect(adapter2.requests).toHaveLength(1)
      expect(adapter2.requests[0]?.model).toBe('mock-profile-upgraded')

      // 8. Start New Topic: creates fresh root session for same profile
      const topic2 = await harness2.assistants.startNewTopic(profileId, {
        title: 'New Investigation',
      })
      expect(topic2.rootSessionId).not.toBe(rootSessionId)

      await harness2.assistants.submitPrompt({
        requestId: 'req-5' as SessionRequestId,
        sessionId: topic2.rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Fresh topic prompt.' }],
      })
      const agentTopic2 = await harness2.controller.resolveAgent(topic2.rootSessionId)
      if ('agent' in agentTopic2) {
        await agentTopic2.agent.whenIdle()
      }

      expect(adapter2.requests).toHaveLength(2)
      expect(adapter2.requests[1]?.model).toBe('mock-profile-upgraded')

      // Verify new topic inherits updated role instructions
      const topic2SystemText = extractMessageText(adapter2.requests[1]?.messages.find(m => m.role === 'system'))
      expect(topic2SystemText).toContain('Focus strictly on atomic transitions and bounded contexts.')

      // 9. Permitted sessions list contains both active topics
      let permitted = await harness2.assistants.listPermittedSessions(profileId)
      expect(permitted).toHaveLength(2)
      expect(permitted).toContain(rootSessionId)
      expect(permitted).toContain(topic2.rootSessionId)

      // 10. Archive profile blocks submissions and topics
      await harness2.assistants.archiveProfile(profileId)

      await expect(
        harness2.assistants.submitPrompt({
          requestId: 'req-fail' as SessionRequestId,
          sessionId: rootSessionId,
          mode: 'queue',
          content: [{ type: 'text', text: 'Should fail' }],
        }),
      ).rejects.toThrow(/Cannot submit prompt to archived assistant profile/)

      await expect(
        harness2.assistants.startNewTopic(profileId),
      ).rejects.toThrow(/Cannot create conversation for archived assistant profile/)

      permitted = await harness2.assistants.listPermittedSessions(profileId)
      expect(permitted).toHaveLength(0)

      // All surfaces never modified app default model
      expect(harness2.ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'mock', model: 'mock' })
    } finally {
      await harness2.dispose()
    }
  })
})
