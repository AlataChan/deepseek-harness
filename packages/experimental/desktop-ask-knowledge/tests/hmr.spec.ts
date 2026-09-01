/** Disposing the overlay fiber drops the service, tools, and prompt section. */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootOverlay } from './helpers/boot.ts'

describe('ask-knowledge HMR', () => {
  it('removes askKnowledge, retrieve tools, and the prompt section after dispose', async () => {
    const { ctx, fiber, sections } = await bootOverlay({ sessions: true, tools: true })
    const session = ctx.sessions.prepare(SessionId('hmr'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const library = await ctx.askKnowledge.createLibrary({ displayName: 'HMR' })
    await ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    expect(ctx.tools.schemas().some(schema => schema.name === 'ask_knowledge_retrieve')).toBe(true)
    const assembled = await ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(JSON.stringify(assembled)).toContain('ask_knowledge_retrieve')
    expect(sections.has('ask-knowledge:retrieve')).toBe(true)
    await fiber.dispose()
    expect(ctx.get('askKnowledge')).toBeUndefined()
    expect(ctx.tools.schemas().some(schema => schema.name === 'ask_knowledge_retrieve')).toBe(false)
    expect(sections.has('ask-knowledge:retrieve')).toBe(false)
    const after = await ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(JSON.stringify(after)).not.toContain('ask_knowledge_retrieve')
  })
})
