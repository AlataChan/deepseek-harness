/**
 * Rigorous verification of admission and isolation ordering seam (S5):
 * - Route resolution and validation run before a submission is admitted (submitPrompt)
 * - Admission path carrying images with vision route vs text-only route end-to-end
 * - Route changing while a prompt with images is admitted fails visibly with UNSUPPORTED_CONTENT
 * - Official-prompt bypass (direct ctx.sessionController.prompt on bound session):
 *   - text prompt still uses overlay's effective route at request boundary
 *   - capability mismatch with images fails visibly
 *   - vision assistant with text-only app default admits and succeeds on vision model
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'

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
      ...(modalities !== undefined ? { inputModalities: modalities } : {}),
    })
  }
}

class ControllableMultiModalAdapter extends MultiModalMockAdapter {
  resolveBlockedStream?: (() => void) | undefined
  private streamBlockedPromise?: Promise<void> | undefined

  constructor(modalitiesByModel: Record<string, readonly ('text' | 'image')[]> = {}) {
    super([], modalitiesByModel)
    this.streamBlockedPromise = new Promise<void>((resolve) => {
      this.resolveBlockedStream = resolve
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
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
  agent.followup(
    createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  )
}

describe('Admission and Isolation Ordering Seam (S5)', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('proves submitPrompt validates route against served catalog before admitting submission', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('ok')], {
      'mock-valid': ['text'],
    })
    harness = await setupAssistantHarness(adapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Valid Asst',
      responsibility: 'Testing',
      defaultModel: { provider: 'mock', model: 'mock-valid' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    // Simulate an invalid/unavailable route override on the conversation
    Reflect.set(conv, 'modelOverride', {
      provider: 'non-existent-provider',
      model: 'some-model',
    })

    await expect(
      assistants.submitPrompt({
        requestId: 'req-invalid-route' as SessionRequestId,
        sessionId: lead.id,
        mode: 'queue',
        content: [{ type: 'text', text: 'hello' }],
      }),
    ).rejects.toMatchObject({ code: 'NO_ADAPTER' })

    // Agent inbox remains empty, no request executed
    expect(adapter.requests).toHaveLength(0)
  })

  it('proves submitPrompt admits prompt with images on vision route and completes end-to-end', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('vision output')], {
      'mock-vision': ['text', 'image'],
      'mock-text': ['text'],
    })
    harness = await setupAssistantHarness(adapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Vision Assistant',
      responsibility: 'Analyzes visual diagrams',
      defaultModel: { provider: 'mock', model: 'mock-vision' },
    })
    await assistants.createConversation(profile.id, lead.id)

    const result = await assistants.submitPrompt({
      requestId: 'req-vision-1' as SessionRequestId,
      sessionId: lead.id,
      mode: 'queue',
      content: [
        { type: 'text', text: 'what is in this diagram?' },
        {
          type: 'image',
          mediaType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      ],
    })

    expect(result.accepted).toBe(true)
    await lead.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.model).toBe('mock-vision')
    expect(lead.session.requestHeader()?.config.model).toBe('mock-vision')
  })

  it('proves submitPrompt rejects prompt with images on text-only route before admission with UNSUPPORTED_CONTENT', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('should not run')], {
      'mock-text': ['text'],
      'mock-vision': ['text', 'image'],
    })
    harness = await setupAssistantHarness(adapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Text Assistant',
      responsibility: 'Text only tasks',
      defaultModel: { provider: 'mock', model: 'mock-text' },
    })
    await assistants.createConversation(profile.id, lead.id)

    let caughtError: unknown
    try {
      await assistants.submitPrompt({
        requestId: 'req-text-image-1' as SessionRequestId,
        sessionId: lead.id,
        mode: 'queue',
        content: [
          { type: 'text', text: 'read this image' },
          { type: 'image', mediaType: 'image/png', data: 'base64data' },
        ],
      })
    } catch (err) {
      caughtError = err
    }

    expect(caughtError).toBeDefined()
    expect(String(caughtError)).toContain('does not support image input')
    expect((caughtError as { code?: string }).code).toBe('UNSUPPORTED_CONTENT')

    // Admission was refused: no turn executed
    expect(adapter.requests).toHaveLength(0)
  })

  it('proves route change to text-only while prompt with images is admitted fails visibly at request boundary', async () => {
    const controllableAdapter = new ControllableMultiModalAdapter({
      'mock-vision': ['text', 'image'],
      'mock-text': ['text'],
    })
    harness = await setupAssistantHarness(controllableAdapter)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Swappable Assistant',
      responsibility: 'Vision to text test',
      defaultModel: { provider: 'mock', model: 'mock-vision' },
    })
    const conv = await assistants.createConversation(profile.id, lead.id)

    // Start turn 1 with text
    sendUserText(lead, 'turn 1 text')

    // Wait until turn 1 is streaming mid-flight in the adapter
    await vi.waitFor(() => {
      expect(controllableAdapter.requests.length).toBe(1)
    })
    expect(controllableAdapter.requests[0]?.model).toBe('mock-vision')

    // While turn 1 is mid-flight, admit prompt 2 with images into the queue
    // (currently active route is mock-vision, so submitPrompt admission succeeds)
    const promptValue = await assistants.submitPrompt({
      requestId: 'req-queued-image' as SessionRequestId,
      sessionId: lead.id,
      mode: 'queue',
      content: [
        { type: 'text', text: 'turn 2 has an image' },
        { type: 'image', mediaType: 'image/png', data: 'valid-image-bytes' },
      ],
    })
    expect(promptValue.accepted).toBe(true)

    // Now switch route to text-only BEFORE prompt 2 executes its request boundary
    await assistants.setConversationModelOverride(conv.id, { provider: 'mock', model: 'mock-text' })

    // Unblock turn 1 stream to finish
    controllableAdapter.resolveBlockedStream!()

    // Wait for the full loop (turn 1 completion + turn 2 execution) to settle
    await lead.whenIdle()

    // Turn 1 succeeded with mock-vision
    expect(controllableAdapter.requests).toHaveLength(1)

    // Turn 2 executed prompt 2 with images under effective route mock-text,
    // which failed visibly at the request boundary with UNSUPPORTED_CONTENT
    const endEvent = lead.session.snapshotEvents().findLast(e => e.type === 'turn/end')
    expect(endEvent).toBeDefined()
    expect(endEvent?.data.reason).toMatchObject({
      kind: 'error',
      error: { code: 'UNSUPPORTED_CONTENT' },
    })
  })

  it('covers official-prompt bypass: text prompt through ctx.sessionController.prompt uses overlay effective route', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('bypass text response')], {
      'mock-default': ['text'],
      'mock-asst': ['text'],
    })
    harness = await setupAssistantHarness(adapter)
    const { ctx, assistants, lead, controller } = harness

    // Set app default model to mock-default
    ctx.agentDefaultModel.currentSelection = () => ({ provider: 'mock', model: 'mock-default' })

    const profile = await assistants.createProfile({
      name: 'Bypass Target Assistant',
      responsibility: 'Custom routing',
      defaultModel: { provider: 'mock', model: 'mock-asst' },
    })
    await assistants.createConversation(profile.id, lead.id)

    // Direct bypass: call sessionController.prompt directly
    const result = await controller.prompt(
      {
        requestId: 'req-direct-bypass' as SessionRequestId,
        sessionId: lead.id,
        mode: 'queue',
        content: [{ type: 'text', text: 'direct bypass message' }],
      },
      new AbortController().signal,
    )
    expect(result.accepted).toBe(true)

    await lead.whenIdle()

    // Effective route mock-asst must have been applied, NOT mock-default
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.model).toBe('mock-asst')
    expect(lead.session.requestHeader()?.config.model).toBe('mock-asst')
  })

  it('covers official-prompt bypass: capability mismatch with images on text-only assistant fails visibly', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('should never run')], {
      'mock-vision': ['text', 'image'],
      'mock-text': ['text'],
    })
    harness = await setupAssistantHarness(adapter)
    const { ctx, assistants, lead, controller } = harness

    // App default has vision
    ctx.agentDefaultModel.currentSelection = () => ({ provider: 'mock', model: 'mock-vision' })

    const profile = await assistants.createProfile({
      name: 'Text Only Assistant',
      responsibility: 'Only text',
      defaultModel: { provider: 'mock', model: 'mock-text' },
    })
    await assistants.createConversation(profile.id, lead.id)

    // Direct call to sessionController.prompt with image
    // Due to synchronized selection, sessionController.prompt rejects at admission
    await expect(
      controller.prompt(
        {
          requestId: 'req-direct-bypass-image-fail' as SessionRequestId,
          sessionId: lead.id,
          mode: 'queue',
          content: [
            { type: 'text', text: 'image in text assistant' },
            { type: 'image', mediaType: 'image/png', data: 'data' },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow()

    expect(adapter.requests).toHaveLength(0)
  })

  it('covers official-prompt bypass: vision assistant admits and succeeds even when app default is text-only', async () => {
    const adapter = new MultiModalMockAdapter([textResponse('vision succeeded')], {
      'mock-vision': ['text', 'image'],
      'mock-text-default': ['text'],
    })
    harness = await setupAssistantHarness(adapter)
    const { ctx, assistants, lead, controller } = harness

    // App default is text-only
    ctx.agentDefaultModel.currentSelection = () => ({ provider: 'mock', model: 'mock-text-default' })

    const profile = await assistants.createProfile({
      name: 'Vision Assistant',
      responsibility: 'Vision tasks',
      defaultModel: { provider: 'mock', model: 'mock-vision' },
    })
    await assistants.createConversation(profile.id, lead.id)

    // Direct bypass: sessionController.prompt with image
    // Because selection is synced to mock-vision, sessionController.prompt admits it
    const res = await controller.prompt(
      {
        requestId: 'req-direct-bypass-vision-ok' as SessionRequestId,
        sessionId: lead.id,
        mode: 'queue',
        content: [
          { type: 'text', text: 'vision diagram analysis' },
          { type: 'image', mediaType: 'image/png', data: 'valid-bytes' },
        ],
      },
      new AbortController().signal,
    )
    expect(res.accepted).toBe(true)

    await lead.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.model).toBe('mock-vision')
    expect(lead.session.requestHeader()?.config.model).toBe('mock-vision')
  })
})
