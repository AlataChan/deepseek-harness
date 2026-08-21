import { renderToString } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { installTuiQuestions } from '../src/driver/questions.ts'
import { QuestionsPanel } from '../src/render/questions.tsx'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const session = ctx.sessions.create(SessionId('owned'))
  const agent = { id: session.id, session } as Agent
  ctx.agents.enter(agent, undefined)
  const store = createTuiStore(createInitialState({ columns: 80 }))
  const questions = installTuiQuestions(ctx, { owner: () => agent, store })
  return { ctx, agent, store, questions }
}

describe('tui user-question provider', () => {
  it('renders single, multiple, option, free-form, and review detail fields', async () => {
    const test = await bench()
    const pending = test.ctx.userQuestions.ask({
      agent: test.agent,
      questions: [
        { id: 'target', header: 'Target', question: 'Choose target', options: [{ label: 'Code', description: 'Source files' }, { label: 'Docs' }] },
        { id: 'notes', question: 'Additional notes' },
        { id: 'review', question: 'Approve plan?', detail: '# Plan\nShip it', options: [{ label: 'Approve' }, { label: 'Revise' }], intent: { kind: 'plan-review', approve: 'Approve' } },
      ],
    })
    await Promise.resolve()
    const interaction = test.store.getSnapshot().interaction
    expect(interaction?.kind).toBe('question')
    if (interaction?.kind !== 'question') throw new Error('question interaction was not published')
    const rendered = renderToString(<QuestionsPanel interaction={interaction} />)
    expect(rendered).toContain('Target')
    expect(rendered).toContain('Code · Source files')
    expect(rendered).toContain('Additional notes')
    expect(rendered).toContain('# Plan')

    expect(test.questions.answer(interaction.id, { answers: [
      { id: 'target', selected: ['Code'] },
      { id: 'notes', selected: [], custom: 'Ship today' },
      { id: 'review', selected: ['Approve'] },
    ] })).toBe(true)
    await expect(pending).resolves.toEqual({ answers: [
      { id: 'target', selected: ['Code'] },
      { id: 'notes', selected: [], custom: 'Ship today' },
      { id: 'review', selected: ['Approve'] },
    ] })
    await test.ctx.fiber.dispose()
  })

  it('keeps every required answer pending until the complete batch validates atomically', async () => {
    const test = await bench()
    const pending = test.ctx.userQuestions.ask({
      agent: test.agent,
      questions: [
        { id: 'one', question: 'One?', options: [{ label: 'A' }] },
        { id: 'two', question: 'Two?' },
      ],
    })
    await Promise.resolve()
    const interaction = test.store.getSnapshot().interaction
    if (interaction?.kind !== 'question') throw new Error('question interaction was not published')
    expect(test.questions.answer(interaction.id, {
      answers: [{ id: 'one', selected: ['A'] }],
    })).toBe(false)
    expect(test.store.getSnapshot().interaction?.id).toBe(interaction.id)

    expect(test.questions.answer(interaction.id, { answers: [
      { id: 'one', selected: ['A'] },
      { id: 'two', selected: [], custom: 'B' },
    ] })).toBe(true)
    await expect(pending).resolves.toBeDefined()
    await test.ctx.fiber.dispose()
  })

  it('rejects on abort or disposal and closes only the matching overlay', async () => {
    const aborted = await bench()
    const abort = new AbortController()
    const first = aborted.ctx.userQuestions.ask({
      agent: aborted.agent, signal: abort.signal,
      questions: [{ id: 'one', question: 'One?' }],
    })
    await Promise.resolve()
    abort.abort()
    await expect(first).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(aborted.store.getSnapshot().interaction).toBeUndefined()
    await aborted.ctx.fiber.dispose()

    const disposed = await bench()
    const second = disposed.ctx.userQuestions.ask({
      agent: disposed.agent, questions: [{ id: 'two', question: 'Two?' }],
    })
    await Promise.resolve()
    disposed.questions.dispose()
    await expect(second).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(disposed.store.getSnapshot().interaction).toBeUndefined()
    await disposed.ctx.fiber.dispose()
  })

  it('preserves the service duplicate-provider error', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    ctx.userQuestions.registerProvider({ ask: () => Promise.resolve({ answers: [] }) })
    const store = createTuiStore(createInitialState({ columns: 80 }))

    expect(() => installTuiQuestions(ctx, { owner: () => undefined, store }))
      .toThrow(/already registered/)
    await ctx.fiber.dispose()
  })
})
