import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  mountAgentLoopTestDependencies,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { mintImSessionRequestId, createImPromptSource } from '../src/source.ts'

const MOCK_LLM_SCRIPT: StreamChunk[] = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'Hello! This is a keyless mock response.' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello! This is a keyless mock response.' } },
  { type: 'finish', reason: { kind: 'stop' } },
]

class KeylessMockAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield * MOCK_LLM_SCRIPT
  }
}

describe('Public Agent Lifecycle & Keyless Mock PoC (Acceptance 5)', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-poc-lifecycle-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('exercises full Agent lifecycle: create, followup, whenIdle, flush, interaction, cancel, resume, and dispose', async () => {
    const ctx = new Context()

    // 1. Mount standard dependencies and durability persistence
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(ApprovalService, { policy: 'ask' })

    // 2. Register keyless mock LLM adapter
    ctx.llm.registerAdapter(['keyless-mock'], new KeylessMockAdapter())

    const sessionId = SessionId('agent-lifecycle-poc-session')

    // 3. Public Agent create
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: '/workspace' },
      agentOptions: {
        provider: 'keyless-mock',
        model: 'mock-model',
      },
    })

    expect(handle.agent).toBeDefined()
    expect(handle.agent.id).toBe(sessionId)
    expect(handle.agent.status).toBe('idle')

    // 4. Public Agent followup with Option (c) IM prompt
    const imRequestId = mintImSessionRequestId()
    const promptSource = createImPromptSource(imRequestId, 'Asia/Shanghai')
    const userMsg = createUserMessage({
      content: [{ type: 'text', text: 'Hello from Feishu IM!' }],
      source: promptSource,
    })

    handle.agent.followup(userMsg)

    // 5. Public Agent whenIdle
    await handle.agent.whenIdle()
    expect(handle.agent.status).toBe('idle')

    // Verify session log captured turn and assistant response
    const events = handle.agent.session.snapshotEvents()
    const userEvent = events.find(e => e.type === 'user/message')
    expect(userEvent).toBeDefined()
    expect(userEvent?.data.source).toEqual(promptSource)

    const assistantEvent = events.find(e => e.type === 'assistant/message')
    expect(assistantEvent).toBeDefined()
    const firstBlock = assistantEvent?.data.message.content[0]
    expect(firstBlock?.type).toBe('text')
    if (firstBlock && firstBlock.type === 'text') {
      expect(firstBlock.text).toContain('keyless mock response')
    }

    // 6. Public Session flush (with JsonlSessionPersistence active)
    const flushed = await ctx.sessions.flush(handle.agent.session)
    expect(flushed).toBe(true)

    // 7. Interaction (Approval policy)
    ctx.approval.setPolicy(handle.agent, 'never')
    expect(ctx.approval.overrideOf(handle.agent.session)).toBe('never')

    // 8. Public Agent cancel
    handle.agent.cancel({ kind: 'user' })
    expect(handle.agent.status).toBe('idle')

    // 9. Teardown / dispose handle
    await handle.dispose()
    expect(ctx.agents.get(sessionId)).toBeUndefined()

    // 10. Public Agent resume from durable storage
    const resumedHandle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: {
        provider: 'keyless-mock',
        model: 'mock-model',
      },
    })

    expect(resumedHandle.agent).toBeDefined()
    expect(resumedHandle.agent.id).toBe(sessionId)
    expect(resumedHandle.agent.status).toBe('idle')
    expect(resumedHandle.agent.session.snapshotEvents().length).toBeGreaterThan(0)

    await resumedHandle.dispose()
    await ctx.fiber.dispose()
  })
})
