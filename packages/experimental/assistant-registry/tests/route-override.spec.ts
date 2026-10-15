/**
 * Rigorous verification of the model-route seam:
 * (a) Next request uses resolved route
 * (b) agentDefaultModel.currentSelection() is unchanged
 * (c) Independent cold resume re-applies route
 * (d) Unbound sessions are untouched
 * (e) Conversation override wins across consumption boundary & survives restart
 * (f) Profile/seat change reaches conversations without override and never ones with one
 * (g) Route change validated against served catalog; unavailable fails visibly
 * (h) Route change never applies mid-stream; applies from next request boundary
 * (i) Requests carrying images fail visibly with retry path if routed to text-only model
 * Controlled edit test: captured route shared by prompt variables and request header
 * Route notice test: at most one accurate notice per change, no repeated false ones
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'
import { TeamSeatId } from '../src/types.ts'

class MultiModalMockAdapter extends MockAdapter {
  constructor(
    script: (StreamChunk[] | ((options: unknown) => StreamChunk[]) | 'hang' | 'hang-slow' | { hangAfter: StreamChunk[] })[] = [],
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

class ControllableStreamAdapter extends MockAdapter {
  resolveBlockedStream?: (() => void) | undefined
  private streamBlockedPromise?: Promise<void> | undefined

  constructor() {
    super([])
    this.streamBlockedPromise = new Promise<void>((resolve) => {
      this.resolveBlockedStream = resolve
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'partial ' }
    if (this.streamBlockedPromise) {
      await this.streamBlockedPromise
      this.streamBlockedPromise = undefined
    }
    yield { type: 'text-delta', index: 0, text: 'complete' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'partial complete' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function sendUserText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

describe('Model Route Seam (S3)', { timeout: 30_000 }, () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('proves (a) next request uses resolved route and (b) agentDefaultModel.currentSelection() is unchanged', async () => {
    const script = [textResponse('response 1')]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants, lead } = harness

    const initialDefault = { ...ctx.agentDefaultModel.currentSelection() }

    const profile = await assistants.createProfile({
      name: 'Coder',
      responsibility: 'Writes code',
      defaultModel: { provider: 'mock', model: 'mock-coder' },
    })

    const conv = await assistants.createConversation(profile.id, lead.id)
    expect(conv.rootSessionId).toBe(lead.id)

    sendUserText(lead, 'hello coder')
    await lead.whenIdle()

    // Assert request used the resolved profile model
    expect(harness.adapter.requests).toHaveLength(1)
    expect(harness.adapter.requests[0]?.model).toBe('mock-coder')
    expect(lead.session.requestHeader()?.config.model).toBe('mock-coder')

    // Assert application default model remains untouched
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(initialDefault)
  })

  it('proves (c) an independent cold resume re-applies the route', async () => {
    const script = [textResponse('turn 1'), textResponse('turn 2')]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants } = harness

    const handle = await ctx.agents.create({
      sessionId: SessionId('cold-resume-agent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const agent = handle.agent

    const profile = await assistants.createProfile({
      name: 'Resumable',
      responsibility: 'Maintains identity across resumes',
      defaultModel: { provider: 'mock', model: 'mock-resumable' },
    })
    await assistants.createConversation(profile.id, agent.id)

    sendUserText(agent, 'turn 1 input')
    await agent.whenIdle()
    expect(harness.adapter.requests[0]?.model).toBe('mock-resumable')

    // Dispose agent to simulate unload
    const sessionId = agent.id
    await handle.dispose()
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    // Cold resume through ctx.agents.resume
    const resumedHandle = await ctx.agents.resume({ resumeSessionId: sessionId })
    const resumed = resumedHandle.agent

    sendUserText(resumed, 'turn 2 input after resume')
    await resumed.whenIdle()

    expect(harness.adapter.requests).toHaveLength(2)
    expect(harness.adapter.requests[1]?.model).toBe('mock-resumable')
    expect(resumed.session.requestHeader()?.config.model).toBe('mock-resumable')

    await resumedHandle.dispose()
  })

  it('proves (d) unbound sessions are untouched', async () => {
    const script = [textResponse('unbound response')]
    harness = await setupAssistantHarness(script)
    const { ctx } = harness

    const unboundId = SessionId('unbound-session')
    const unbound = await ctx.agentLoop.create(unboundId, { provider: 'mock', model: 'mock-unbound' })

    sendUserText(unbound, 'hello unbound')
    await unbound.whenIdle()

    expect(harness.adapter.requests).toHaveLength(1)
    expect(harness.adapter.requests[0]?.model).toBe('mock-unbound')
    expect(unbound.session.requestHeader()?.config.model).toBe('mock-unbound')
  })

  it('proves (e) conversation override wins across consumption boundary (requests 1, 2, 3) and survives restart', async () => {
    const script = [
      textResponse('resp 1'),
      textResponse('resp 2'),
      textResponse('resp 3'),
      textResponse('resp 4'),
    ]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants } = harness

    const initialDefault = { ...ctx.agentDefaultModel.currentSelection() }

    const handle = await ctx.agents.create({
      sessionId: SessionId('consumption-boundary-agent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const agent = handle.agent

    const profile = await assistants.createProfile({
      name: 'Base Profile',
      responsibility: 'Base',
      defaultModel: { provider: 'mock', model: 'profile-model' },
    })

    await assistants.createConversation(profile.id, agent.id, {
      modelOverride: { provider: 'mock', model: 'override-model' },
    })

    // Request 1
    sendUserText(agent, 'req 1')
    await agent.whenIdle()
    expect(harness.adapter.requests[0]?.model).toBe('override-model')

    // Request 2: verify it was NOT consumed/reverted to profile-model
    sendUserText(agent, 'req 2')
    await agent.whenIdle()
    expect(harness.adapter.requests[1]?.model).toBe('override-model')

    // Request 3: verify it stays on override-model
    sendUserText(agent, 'req 3')
    await agent.whenIdle()
    expect(harness.adapter.requests[2]?.model).toBe('override-model')

    // Restart agent
    const sessionId = agent.id
    await handle.dispose()
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    const resumedHandle = await ctx.agents.resume({ resumeSessionId: sessionId })
    const resumed = resumedHandle.agent

    // Request 4
    sendUserText(resumed, 'req 4')
    await resumed.whenIdle()
    expect(harness.adapter.requests[3]?.model).toBe('override-model')

    // App default still untouched
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(initialDefault)

    await resumedHandle.dispose()
  })

  it('proves (f) profile and seat changes reach conversations without override and never ones with one', async () => {
    const script = [
      textResponse('c1 r1'),
      textResponse('c2 r1'),
      textResponse('c1 r2'),
      textResponse('c2 r2'),
      textResponse('c1 r3'),
      textResponse('c2 r3'),
    ]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants, lead } = harness

    const session2Id = SessionId('session-2')
    const agent2 = await ctx.agentLoop.create(session2Id, { provider: 'mock', model: 'mock' })

    const profile = await assistants.createProfile({
      name: 'Multi-conv Profile',
      responsibility: 'Tests propagation',
      defaultModel: { provider: 'mock', model: 'profile-v1' },
    })

    // Conv 1: inherits profile default
    await assistants.createConversation(profile.id, lead.id)

    // Conv 2: has explicit conversation override
    await assistants.createConversation(profile.id, agent2.id, {
      modelOverride: { provider: 'mock', model: 'conv-override-fixed' },
    })

    // Turn 1
    sendUserText(lead, 'c1 t1')
    await lead.whenIdle()
    sendUserText(agent2, 'c2 t1')
    await agent2.whenIdle()

    expect(harness.adapter.requests[0]?.model).toBe('profile-v1')
    expect(harness.adapter.requests[1]?.model).toBe('conv-override-fixed')

    // Update Profile default model to v2
    await assistants.updateProfile(profile.id, {
      defaultModel: { provider: 'mock', model: 'profile-v2' },
    })

    // Turn 2: Conv 1 adopts profile-v2; Conv 2 stays on conv-override-fixed
    sendUserText(lead, 'c1 t2')
    await lead.whenIdle()
    sendUserText(agent2, 'c2 t2')
    await agent2.whenIdle()

    expect(harness.adapter.requests[2]?.model).toBe('profile-v2')
    expect(harness.adapter.requests[3]?.model).toBe('conv-override-fixed')

    // Set Seat override on seat-1 and bind both sessions to seat-1
    const seatId = TeamSeatId('seat-lead')
    await assistants.setSeatModelOverride(seatId, { provider: 'mock', model: 'seat-override-model' })
    assistants.bindSessionToSeat(lead.id, seatId)
    assistants.bindSessionToSeat(agent2.id, seatId)

    // Turn 3: Conv 1 adopts seat override (seat > profile); Conv 2 stays on conv override (conv > seat)
    sendUserText(lead, 'c1 t3')
    await lead.whenIdle()
    sendUserText(agent2, 'c2 t3')
    await agent2.whenIdle()

    expect(harness.adapter.requests[4]?.model).toBe('seat-override-model')
    expect(harness.adapter.requests[5]?.model).toBe('conv-override-fixed')
  })

  it('proves (g) accepted changes are validated against the served catalog first and unavailable routes fail visibly', async () => {
    harness = await setupAssistantHarness([])
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Validator',
      responsibility: 'Validation tester',
      defaultModel: { provider: 'mock', model: 'valid-model' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    // Attempting an unknown provider must reject with NO_ADAPTER
    await expect(
      assistants.setConversationModelOverride(conv.id, {
        provider: 'non-existent-provider',
        model: 'some-model',
      }),
    ).rejects.toMatchObject({ code: 'NO_ADAPTER' })

    // Verify conversation override was NOT updated or substituted
    const storedConv = await assistants.getConversation(conv.id)
    expect(storedConv?.modelOverride).toBeUndefined()

    // Attempting to create a profile with invalid provider must reject
    await expect(
      assistants.createProfile({
        name: 'Invalid',
        responsibility: 'Testing',
        defaultModel: { provider: 'unknown-provider', model: 'model' },
      }),
    ).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })

  it('proves (h) a route change never applies mid-stream — it applies from the next request boundary', async () => {
    const controllableAdapter = new ControllableStreamAdapter()
    harness = await setupAssistantHarness(controllableAdapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Stream Test',
      responsibility: 'Mid-stream isolation',
      defaultModel: { provider: 'mock', model: 'model-turn-1' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    sendUserText(lead, 'start turn 1')

    // Wait until stream has started and request[0] is in flight
    await vi.waitFor(() => {
      expect(controllableAdapter.requests.length).toBe(1)
    })
    expect(controllableAdapter.requests[0]?.model).toBe('model-turn-1')

    // While turn 1 is streaming mid-flight, update conversation override
    await assistants.setConversationModelOverride(conv.id, {
      provider: 'mock',
      model: 'model-turn-2',
    })

    // Now unblock turn 1 stream to complete
    controllableAdapter.resolveBlockedStream!()
    await lead.whenIdle()

    // Request 1 completed using model-turn-1
    expect(controllableAdapter.requests[0]?.model).toBe('model-turn-1')

    // Turn 2 starts at the next request boundary and uses model-turn-2
    sendUserText(lead, 'start turn 2')
    await lead.whenIdle()

    expect(controllableAdapter.requests).toHaveLength(2)
    expect(controllableAdapter.requests[1]?.model).toBe('model-turn-2')
  })

  it('proves (i) requests carrying images fail visibly with retry path if routed to text-only model', async () => {
    const multiAdapter = new MultiModalMockAdapter(
      [textResponse('vision succeeded')],
      {
        'mock-text-only': ['text'],
        'mock-vision': ['text', 'image'],
      },
    )

    harness = await setupAssistantHarness(multiAdapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Vision Gatekeeper',
      responsibility: 'Guards modalities',
      defaultModel: { provider: 'mock', model: 'mock-text-only' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    // Message carrying an image
    const imageMessage = createUserMessage({
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', attachment: { id: 'img-1' } as never },
      ],
      source: { kind: 'user' },
    })

    // Sending image to text-only route fails visibly with UNSUPPORTED_CONTENT at turn/end
    lead.followup(imageMessage)
    await lead.whenIdle()

    const turnEnd = lead.session.snapshotEvents().findLast(e => e.type === 'turn/end')
    expect(turnEnd?.data.reason).toMatchObject({
      kind: 'error',
      error: { code: 'UNSUPPORTED_CONTENT' },
    })

    // Request was NEVER dispatched to the model adapter
    expect(multiAdapter.requests).toHaveLength(0)

    // Switch to vision model
    await assistants.setConversationModelOverride(conv.id, {
      provider: 'mock',
      model: 'mock-vision',
    })

    // Retry path: send message with vision route
    sendUserText(lead, 'retry with vision model')
    await lead.whenIdle()

    expect(multiAdapter.requests).toHaveLength(1)
    expect(multiAdapter.requests[0]?.model).toBe('mock-vision')
  })

  it('proves controlled edit between assembly and request resolution: prompt variables and request header use same captured route', async () => {
    const script = [textResponse('turn 1'), textResponse('turn 2')]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Controlled Edit Assistant',
      responsibility: 'Tests assembly/request coherence',
      defaultModel: { provider: 'mock', model: 'captured-route-A' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    let promptVariablesAtAssembly: Record<string, string | undefined> | undefined
    let editTriggered = false

    // Intercept prompt assembly with prepend: true to observe the post-processed variables
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const assembled = await next()
      const agent = (context as { agent?: Agent }).agent
      if (agent === lead && !editTriggered) {
        editTriggered = true
        promptVariablesAtAssembly = { ...assembled.variables }
        // Controlled edit happens AFTER assembly captured route-A, but BEFORE agent/request executes:
        await assistants.setConversationModelOverride(conv.id, {
          provider: 'mock',
          model: 'captured-route-B',
        })
      }
      return assembled
    }, { prepend: true })

    // Turn 1
    sendUserText(lead, 'turn 1')
    await lead.whenIdle()

    // Prompt variables and logged request header BOTH used captured-route-A!
    expect(promptVariablesAtAssembly?.model).toBe('captured-route-A')
    expect(lead.session.requestHeader()?.config.model).toBe('captured-route-A')
    expect(harness.adapter.requests[0]?.model).toBe('captured-route-A')

    // Turn 2: the new route applies on the next request boundary
    sendUserText(lead, 'turn 2')
    await lead.whenIdle()

    expect(lead.session.requestHeader()?.config.model).toBe('captured-route-B')
    expect(harness.adapter.requests[1]?.model).toBe('captured-route-B')
  })

  it('proves route notice behavior: at most one accurate notice per change and no repeated false ones', async () => {
    const script = [
      textResponse('resp 1'),
      textResponse('resp 2'),
      textResponse('resp 3'),
      textResponse('resp 4'),
    ]
    harness = await setupAssistantHarness(script)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Notice Tester',
      responsibility: 'Verifies model change notices',
      defaultModel: { provider: 'mock', model: 'model-X' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    // Turn 1: Initial request with model-X
    sendUserText(lead, 't1')
    await lead.whenIdle()

    let notices = lead.session.deriveMessages().filter(m => m.source?.kind === 'model-selection')
    expect(notices).toHaveLength(0)

    // Turn 2: Continued request with model-X -> NO notice
    sendUserText(lead, 't2')
    await lead.whenIdle()

    notices = lead.session.deriveMessages().filter(m => m.source?.kind === 'model-selection')
    expect(notices).toHaveLength(0)

    // Switch route to model-Y
    await assistants.setConversationModelOverride(conv.id, {
      provider: 'mock',
      model: 'model-Y',
    })

    // Turn 3: Switched to model-Y -> EXACTLY ONE accurate notice
    sendUserText(lead, 't3')
    await lead.whenIdle()

    notices = lead.session.deriveMessages().filter(m => m.source?.kind === 'model-selection')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('model-X; the session continues with model-Y'),
    })

    // Turn 4: Continued with model-Y -> STILL exactly 1 notice in total (no repeated false ones!)
    sendUserText(lead, 't4')
    await lead.whenIdle()

    notices = lead.session.deriveMessages().filter(m => m.source?.kind === 'model-selection')
    expect(notices).toHaveLength(1)
  })
})
