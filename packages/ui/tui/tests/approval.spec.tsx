import { renderToString } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { installTuiApproval } from '../src/driver/approval.ts'
import { ApprovalPanel } from '../src/render/approval.tsx'
import { createInitialState } from '../src/state/reducer.ts'
import { createTuiStore } from '../src/state/store.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ApprovalService)
  const session = ctx.sessions.create(SessionId('owned'))
  session.append('turn/start', { turn: 1 })
  const agent = { id: session.id, session } as Agent
  const otherSession = ctx.sessions.create(SessionId('other'))
  otherSession.append('turn/start', { turn: 1 })
  const other = { id: otherSession.id, session: otherSession } as Agent
  const store = createTuiStore(createInitialState({ columns: 80 }))
  const approval = installTuiApproval(ctx, { owner: () => agent, store })
  return { ctx, agent, other, store, approval }
}

describe('tui approval answerer', () => {
  it('claims only the exact root and delegates another Agent with next()', async () => {
    const test = await bench()
    test.ctx.on('approval/request', () => Promise.resolve('rejected'))

    await expect(test.ctx.approval.request({ agent: test.other, toolName: 'foreign' }))
      .resolves.toBe('rejected')
    expect(test.store.getSnapshot().interaction).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('shows tool, call, and reason and grants once only on explicit allow', async () => {
    const test = await bench()
    const pending = test.ctx.approval.request({
      agent: test.agent, toolName: 'bash', callId: CallId('call-1'), reason: 'Needs workspace access',
    })
    await Promise.resolve()
    const interaction = test.store.getSnapshot().interaction
    expect(interaction?.kind).toBe('approval')
    if (interaction?.kind !== 'approval') throw new Error('approval interaction was not published')
    const rendered = renderToString(<ApprovalPanel interaction={interaction} />)
    expect(rendered).toContain('bash')
    expect(rendered).toContain('call-1')
    expect(rendered).toContain('Needs workspace access')

    expect(test.approval.allow(interaction.id)).toBe(true)
    expect(test.approval.reject(interaction.id)).toBe(false)
    await expect(pending).resolves.toBe('allowed-once')
    expect(test.store.getSnapshot().interaction).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('rejects explicitly and cancels on request abort', async () => {
    const rejected = await bench()
    const first = rejected.ctx.approval.request({ agent: rejected.agent, toolName: 'write' })
    await Promise.resolve()
    const firstInteraction = rejected.store.getSnapshot().interaction
    if (firstInteraction?.kind !== 'approval') throw new Error('approval interaction was not published')
    expect(rejected.approval.reject(firstInteraction.id)).toBe(true)
    await expect(first).resolves.toBe('rejected')
    await rejected.ctx.fiber.dispose()

    const aborted = await bench()
    const abort = new AbortController()
    const second = aborted.ctx.approval.request({
      agent: aborted.agent, toolName: 'bash', signal: abort.signal,
    })
    await Promise.resolve()
    abort.abort()
    await expect(second).resolves.toBe('cancelled')
    expect(aborted.store.getSnapshot().interaction).toBeUndefined()
    await aborted.ctx.fiber.dispose()
  })

  it('settles shutdown as cancelled and never grants afterward', async () => {
    const test = await bench()
    const pending = test.ctx.approval.request({ agent: test.agent, toolName: 'bash' })
    await Promise.resolve()
    const interaction = test.store.getSnapshot().interaction
    if (interaction?.kind !== 'approval') throw new Error('approval interaction was not published')

    test.approval.dispose()
    expect(test.approval.allow(interaction.id)).toBe(false)
    await expect(pending).resolves.toBe('cancelled')
    await test.ctx.fiber.dispose()
  })
})
