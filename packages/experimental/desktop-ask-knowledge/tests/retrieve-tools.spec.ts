/** Tool execute rejects sentences and accepts names; retrieve returns bodies. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { registerAskKnowledgeTools } from '../src/tools.ts'
import { bootOverlay } from './helpers/boot.ts'

const signal = new AbortController().signal
const cleanups: Array<() => Promise<void> | void> = []
let calls = 0

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function agentWith(session: Session): Agent {
  return { id: session.id, session } as unknown as Agent
}

async function boot() {
  const started = await bootOverlay({ sessions: true, tools: true })
  cleanups.push(() => started.fiber.dispose())
  return started
}

function execute(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: ToolCallId(`ak-${++calls}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

describe('ask-knowledge retrieve tools', () => {
  it('rejects a sentence, empty list, 7 terms, and 17-character name at execute', async () => {
    const { ctx } = await boot()
    const session = ctx.sessions.prepare(SessionId('bound'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const library = await ctx.askKnowledge.createLibrary({ displayName: '库' })
    await ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    const agent = agentWith(session)
    const sentence = await execute(ctx, 'ask_knowledge_retrieve', { terms: ['报销流程是什么？'] }, agent)
    expect(sentence.isError).toBe(true)
    expect(sentence.content.map(block => 'text' in block ? block.text : '').join(''))
      .toContain('请改用 1 到 6 个专名，不要整句。')
    const empty = await execute(ctx, 'ask_knowledge_retrieve', { terms: [] }, agent)
    expect(empty.isError).toBe(true)
    const seven = await execute(ctx, 'ask_knowledge_retrieve', {
      terms: ['一', '二', '三', '四', '五', '六', '七'],
    }, agent)
    expect(seven.isError).toBe(true)
    const long = await execute(ctx, 'ask_knowledge_retrieve', {
      terms: ['一二三四五六七八九十壹贰叁肆伍陆柒'],
    }, agent)
    expect(long.isError).toBe(true)
  })

  it('accepts 党的纪律处分条例 and 报销 and returns page bodies', async () => {
    const { ctx } = await boot()
    const session = ctx.sessions.prepare(SessionId('ok'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const library = await ctx.askKnowledge.createLibrary({ displayName: '库' })
    await ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    const agent = agentWith(session)
    const ordinance = await execute(ctx, 'ask_knowledge_retrieve', {
      terms: ['党的纪律处分条例'],
    }, agent)
    expect(ordinance.isError).toBe(false)
    if (ordinance.isError) throw new Error('expected retrieve success')
    expect(ordinance.value).toMatchObject({
      items: [{ text: expect.stringContaining('党的纪律处分条例') }],
    })
    const expense = await execute(ctx, 'ask_knowledge_retrieve', { terms: ['报销'] }, agent)
    expect(expense.isError).toBe(false)
    if (expense.isError) throw new Error('expected retrieve success')
    expect(expense.value).toMatchObject({ items: [{ text: expect.stringContaining('报销') }] })
    expect(expense.content.map(block => 'text' in block ? block.text : '').join(''))
      .toContain('报销流程正文')
    const lookup = await execute(ctx, 'ask_knowledge_lookup', { term: '报销' }, agent)
    expect(lookup.isError).toBe(false)
    if (lookup.isError) throw new Error('expected lookup success')
    expect(lookup.value).toMatchObject({ text: expect.stringContaining('报销') })
  })

  it('rejects retrieve before a library is hung', async () => {
    const { ctx } = await boot()
    const session = Session.create(SessionId('unbound'))
    const result = await execute(ctx, 'ask_knowledge_retrieve', { terms: ['报销'] }, agentWith(session))
    expect(result.isError).toBe(true)
    expect(result.content.map(block => 'text' in block ? block.text : '').join(''))
      .toContain('先在上方挂上一个知识库。')
    const noAgent = await execute(ctx, 'ask_knowledge_retrieve', { terms: ['报销'] })
    expect(noAgent.isError).toBe(true)
    const lookupSentence = await execute(ctx, 'ask_knowledge_lookup', { term: '什么？' }, agentWith(session))
    expect(lookupSentence.isError).toBe(true)
    const retrieve = ctx.tools.get('ask_knowledge_retrieve')
    const lookup = ctx.tools.get('ask_knowledge_lookup')
    expect(retrieve?.presentCall?.({ terms: ['报销'] })).toMatchObject({ card: 'generic' })
    expect(lookup?.presentCall?.({ term: '报销' })).toMatchObject({ card: 'generic' })
    expect(retrieve?.presentResult?.({ terms: ['报销'] }, { content: [], isError: false })).toMatchObject({ card: 'generic' })
    expect(lookup?.presentResult?.({ term: '报销' }, { content: [], isError: false })).toMatchObject({ card: 'generic' })
    expect(retrieve?.output.render({ terms: ['报销'] }, { items: [] })).toMatchObject([{ type: 'text' }])
    expect(retrieve?.output.render({ terms: ['报销'] }, { items: 1 })).toMatchObject([{ type: 'text' }])
    expect(lookup?.output.render({ term: '报销' }, { term: '报销' })).toMatchObject([{ type: 'text' }])
    expect(lookup?.output.render({ term: '报销' }, { text: '正文' })).toMatchObject([{ type: 'text' }])
  })

  it('renders lookup without optional sidecar fields', async () => {
    const started = await boot()
    const session = started.ctx.sessions.prepare(SessionId('opt'))
    started.ctx.sessions.enter(session)
    started.ctx.sessions.announce(session)
    const library = await started.ctx.askKnowledge.createLibrary({ displayName: '库' })
    await started.ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
    const lookup = vi.spyOn(started.ctx.askKnowledge, 'lookup').mockResolvedValue({
      term: '报销',
      warnings: [],
    })
    const result = await execute(started.ctx, 'ask_knowledge_lookup', { term: '报销' }, agentWith(session))
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected lookup success')
    expect(result.value).toEqual({ term: '报销', warnings: [] })
    lookup.mockRestore()
  })

  it('fails retrieve when askKnowledge is not mounted', async () => {
    const started = await boot()
    await started.fiber.dispose()
    const dispose = registerAskKnowledgeTools(started.ctx)
    const result = await execute(started.ctx, 'ask_knowledge_retrieve', { terms: ['报销'] })
    expect(result.isError).toBe(true)
    dispose()
  })
})
