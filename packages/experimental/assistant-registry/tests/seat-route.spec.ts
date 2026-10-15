import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'

function sendUserText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

class MultiModalMockAdapter extends MockAdapter {
  constructor(
    script: StreamChunk[][] = [],
    private readonly modalitiesByModel: Record<string, readonly ('text' | 'image')[]> = {},
  ) {
    super(script)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const modalities = this.modalitiesByModel[model]
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...modalities !== undefined ? { inputModalities: modalities } : {},
    })
  }
}

describe('Seat Routes for Post-Spawn Changes (S13)', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('proves post-spawn seat override change reaches seat child agent on next request boundary and preserves default model', async () => {
    const script = [textResponse('turn 1 from child'), textResponse('turn 2 from child')]
    harness = await setupAssistantHarness(script, {}, { withCatalog: true })
    const { ctx, assistants } = harness

    const initialDefault = { ...ctx.agentDefaultModel.currentSelection() }

    const profile = await assistants.createProfile({
      name: 'Researcher',
      responsibility: 'Research data',
      defaultModel: { provider: 'mock', model: 'mock-research-default' },
    })

    const team = await assistants.createTeam({
      name: 'Analysis Team',
      coordinatorProfileId: profile.id,
    })

    const seat = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'researcher-1',
      duty: 'Execute research tasks',
    })

    // Spawn / bind child agent session
    const childHandle = await ctx.agents.create({
      sessionId: SessionId('seat-child-session-1'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const childAgent = childHandle.agent
    await assistants.bindSeatSession(seat.id, childAgent.id)

    // Turn 1: inherits profile default model because seat has no override
    sendUserText(childAgent, 'start research')
    await childAgent.whenIdle()

    expect(harness.adapter.requests).toHaveLength(1)
    expect(harness.adapter.requests[0]?.model).toBe('mock-research-default')

    // Post-spawn: update seat model override
    await assistants.setSeatModelOverride(seat.id, {
      provider: 'mock',
      model: 'mock-research-v2',
    })

    // Turn 2: next request boundary uses the updated seat override
    sendUserText(childAgent, 'continue research')
    await childAgent.whenIdle()

    expect(harness.adapter.requests).toHaveLength(2)
    expect(harness.adapter.requests[1]?.model).toBe('mock-research-v2')

    // Application default model remains untouched
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(initialDefault)
  })

  it('enforces precedence: explicit conversation override wins over seat override and restores seat route when cleared', async () => {
    const script = [textResponse('turn 1'), textResponse('turn 2'), textResponse('turn 3')]
    harness = await setupAssistantHarness(script, {}, { withCatalog: true })
    const { ctx, assistants } = harness

    const profile = await assistants.createProfile({
      name: 'Coder',
      responsibility: 'Write code',
      defaultModel: { provider: 'mock', model: 'mock-profile-coder' },
    })

    const team = await assistants.createTeam({
      name: 'Dev Team',
      coordinatorProfileId: profile.id,
    })

    const seat = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'coder-seat',
      duty: 'Code stuff',
      modelOverride: { provider: 'mock', model: 'mock-seat-coder' },
    })

    const handle = await ctx.agents.create({
      sessionId: SessionId('dev-child-1'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const childAgent = handle.agent
    await assistants.bindSeatSession(seat.id, childAgent.id)

    // Initially resolves seat override
    const initialRoute = assistants.resolveEffectiveRoute(childAgent.id)
    expect(initialRoute?.source).toBe('seat')
    expect(initialRoute?.route.model).toBe('mock-seat-coder')

    // Bind conversation override on childAgent
    const conv = await assistants.createConversation(profile.id, childAgent.id)
    await assistants.setConversationModelOverride(conv.id, {
      provider: 'mock',
      model: 'mock-conversation-override',
    })

    // Conversation override wins over seat override
    const convRoute = assistants.resolveEffectiveRoute(childAgent.id)
    expect(convRoute?.source).toBe('conversation')
    expect(convRoute?.route.model).toBe('mock-conversation-override')

    sendUserText(childAgent, 'code with conv override')
    await childAgent.whenIdle()
    expect(harness.adapter.requests[0]?.model).toBe('mock-conversation-override')

    // Clearing conversation override falls back to seat override
    await assistants.clearConversationModelOverride(conv.id)
    const fallbackRoute = assistants.resolveEffectiveRoute(childAgent.id)
    expect(fallbackRoute?.source).toBe('seat')
    expect(fallbackRoute?.route.model).toBe('mock-seat-coder')

    sendUserText(childAgent, 'code with restored seat route')
    await childAgent.whenIdle()
    expect(harness.adapter.requests[1]?.model).toBe('mock-seat-coder')
  })

  it('proves profile model changes reach seat child without override and never one with override', async () => {
    harness = await setupAssistantHarness([], {}, { withCatalog: true })
    const { assistants } = harness

    const profile = await assistants.createProfile({
      name: 'Worker',
      responsibility: 'General work',
      defaultModel: { provider: 'mock', model: 'worker-v1' },
    })

    const team = await assistants.createTeam({
      name: 'Work Team',
      coordinatorProfileId: profile.id,
    })

    // Seat A: without override
    const seatA = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'worker-a',
      duty: 'Duty A',
    })
    const sessionA = SessionId('session-a')
    await assistants.bindSeatSession(seatA.id, sessionA)

    // Seat B: with override
    const seatB = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'worker-b',
      duty: 'Duty B',
      modelOverride: { provider: 'mock', model: 'pinned-v1' },
    })
    const sessionB = SessionId('session-b')
    await assistants.bindSeatSession(seatB.id, sessionB)

    // Initial check
    expect(assistants.resolveEffectiveRoute(sessionA)?.route.model).toBe('worker-v1')
    expect(assistants.resolveEffectiveRoute(sessionB)?.route.model).toBe('pinned-v1')

    // Update profile default model
    await assistants.updateProfile(profile.id, {
      defaultModel: { provider: 'mock', model: 'worker-v2' },
    })

    // Seat A updates to worker-v2; Seat B remains pinned to pinned-v1
    expect(assistants.resolveEffectiveRoute(sessionA)?.route.model).toBe('worker-v2')
    expect(assistants.resolveEffectiveRoute(sessionB)?.route.model).toBe('pinned-v1')
  })

  it('proves independent cold resume re-applies persisted seat model override from catalog', async () => {
    const script = [textResponse('response from resumed seat')]
    harness = await setupAssistantHarness(script, {}, { withCatalog: true })
    const { ctx, assistants } = harness

    const profile = await assistants.createProfile({
      name: 'Analyst',
      responsibility: 'Analysis',
      defaultModel: { provider: 'mock', model: 'analyst-default' },
    })

    const team = await assistants.createTeam({
      name: 'Data Squad',
      coordinatorProfileId: profile.id,
    })

    const seat = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'data-analyst',
      duty: 'Analyze metrics',
      modelOverride: { provider: 'mock', model: 'analyst-special' },
    })

    const childSessionId = SessionId('persisted-seat-child-1')
    await assistants.bindSeatSession(seat.id, childSessionId)

    // Create a new AssistantService attached to the same catalog to simulate restart
    const catalog = harness.catalog!
    const freshAssistants = ctx.get('assistants')!
    freshAssistants.attachCatalog(catalog)
    await freshAssistants.loadFromCatalog()

    // Route resolves from catalog to the persisted seat model override
    const routeAfterResume = freshAssistants.resolveEffectiveRoute(childSessionId)
    expect(routeAfterResume?.source).toBe('seat')
    expect(routeAfterResume?.route.model).toBe('analyst-special')
  })

  it('enforces vision modality: requests with images routed to a seat model without image support throw UNSUPPORTED_CONTENT', async () => {
    const customAdapter = new MultiModalMockAdapter(
      [[{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'hi' }, { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } }]],
      {
        'text-only-model': ['text'],
        'vision-model': ['text', 'image'],
      },
    )

    harness = await setupAssistantHarness(customAdapter, {}, { withCatalog: true })
    const { ctx, assistants } = harness

    const profile = await assistants.createProfile({
      name: 'Vision Tester',
      responsibility: 'Tests images',
      defaultModel: { provider: 'mock', model: 'text-only-model' },
    })

    const team = await assistants.createTeam({
      name: 'Vision Team',
      coordinatorProfileId: profile.id,
    })

    const seat = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'vision-seat',
      duty: 'Handle images',
      modelOverride: { provider: 'mock', model: 'text-only-model' },
    })

    const childHandle = await ctx.agents.create({
      sessionId: SessionId('vision-child-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const childAgent = childHandle.agent
    await assistants.bindSeatSession(seat.id, childAgent.id)

    // Submit prompt carrying an image
    await expect(
      assistants.submitPrompt({
        sessionId: childAgent.id,
        requestId: 'req-vision-probe' as SessionRequestId,
        mode: 'queue',
        content: [
          { type: 'text', text: 'Analyze this image' },
          { type: 'image', mediaType: 'image/png', data: 'AQID' },
        ],
      }),
    ).rejects.toThrow(/does not support image input/)
  })
})
