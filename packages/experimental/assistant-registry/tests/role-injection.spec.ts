/**
 * Rigorous verification of role injection seam (S4):
 * - Role section appears in logged system/message on first turn
 * - session.deriveMessages() reconstructs system message containing formatted role text
 * - Updating profile responsibility/instructions takes effect on next request without rewriting history
 * - Startup enumeration and agent/created lifecycle coverage
 * - Unbound agents remain untouched
 * - Formatter handles optional instructions
 */

import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'
import { formatAssistantRoleText } from '../src/role-injection.ts'

function sendUserText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

describe('Role Injection Seam (S4)', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('formats role text with and without optional instructions', () => {
    const withInstructions = formatAssistantRoleText({
      id: 'asst-1' as never,
      name: 'Researcher',
      responsibility: 'Analyze climate data',
      instructions: 'Be concise and use metric units',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(withInstructions).toBe(
      'You are Researcher.\n\nResponsibility:\nAnalyze climate data\n\nInstructions:\nBe concise and use metric units',
    )

    const withoutInstructions = formatAssistantRoleText({
      id: 'asst-2' as never,
      name: 'Summarizer',
      responsibility: 'Summarize news articles',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(withoutInstructions).toBe(
      'You are Summarizer.\n\nResponsibility:\nSummarize news articles',
    )

    const emptyInstructions = formatAssistantRoleText({
      id: 'asst-3' as never,
      name: 'Reviewer',
      responsibility: 'Review pull requests',
      instructions: '   \n  ',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(emptyInstructions).toBe(
      'You are Reviewer.\n\nResponsibility:\nReview pull requests',
    )
  })

  it('proves role section appears in logged system/message and is reconstructable via deriveMessages()', async () => {
    const script = [textResponse('hello from researcher')]
    harness = await setupAssistantHarness(script)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Climate Analyst',
      responsibility: 'Evaluate regional carbon emission trends',
      instructions: 'Always cite dataset source years and uncertainties.',
    })

    await assistants.createConversation(profile.id, lead.id)

    sendUserText(lead, 'Give me an analysis of 2025 emissions.')
    await lead.whenIdle()

    // 1. Verify role section appears in logged system/message event
    const events = lead.session.snapshotEvents()
    const systemEvents = events.filter(e => e.type === 'system/message')
    expect(systemEvents.length).toBeGreaterThanOrEqual(1)

    const firstSystemEvent = systemEvents[0]
    expect(firstSystemEvent).toBeDefined()
    const systemContent = firstSystemEvent!.data.message.content
      .map(c => (c.type === 'text' ? c.text : ''))
      .join('\n')

    expect(systemContent).toContain('You are Climate Analyst.')
    expect(systemContent).toContain('Responsibility:\nEvaluate regional carbon emission trends')
    expect(systemContent).toContain('Instructions:\nAlways cite dataset source years and uncertainties.')

    // 2. Verify deriveMessages() reconstructs system message containing formatted role text
    const derived = lead.session.deriveMessages()
    const derivedSystem = derived.find(m => m.role === 'system')
    expect(derivedSystem).toBeDefined()
    const derivedText = derivedSystem!.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('\n')

    expect(derivedText).toContain('You are Climate Analyst.')
    expect(derivedText).toContain('Responsibility:\nEvaluate regional carbon emission trends')
    expect(derivedText).toContain('Instructions:\nAlways cite dataset source years and uncertainties.')
  })

  it('proves editing responsibility/instructions takes effect on next request without rewriting history', async () => {    const script = [textResponse('turn 1 response'), textResponse('turn 2 response')]
    harness = await setupAssistantHarness(script)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Policy Drafter',
      responsibility: 'Draft municipal water policies',
      instructions: 'Use formal administrative tone.',
    })

    await assistants.createConversation(profile.id, lead.id)

    // Turn 1
    sendUserText(lead, 'Draft section 1.')
    await lead.whenIdle()

    const eventsTurn1 = lead.session.snapshotEvents()
    const sysEventsTurn1 = eventsTurn1.filter(e => e.type === 'system/message')
    expect(sysEventsTurn1.length).toBeGreaterThanOrEqual(1)
    const turn1SysSeq = sysEventsTurn1[0]!.seq
    const turn1SysContent = sysEventsTurn1[0]!.data.message.content
      .map(c => (c.type === 'text' ? c.text : ''))
      .join('\n')

    expect(turn1SysContent).toContain('Responsibility:\nDraft municipal water policies')
    expect(turn1SysContent).toContain('Instructions:\nUse formal administrative tone.')
    expect(turn1SysContent).not.toContain('Review coastal wastewater permits')

    // Edit profile responsibility and instructions before Turn 2
    await assistants.updateProfile(profile.id, {
      responsibility: 'Review coastal wastewater permits',
      instructions: 'Include environmental impact score thresholds.',
    })

    // Turn 2
    sendUserText(lead, 'Review application #402.')
    await lead.whenIdle()

    const eventsTurn2 = lead.session.snapshotEvents()
    const sysEventsTurn2 = eventsTurn2.filter(e => e.type === 'system/message')
    expect(sysEventsTurn2.length).toBeGreaterThanOrEqual(2)

    // Assert immutable history: turn 1 system/message event unchanged in snapshot log
    const preservedTurn1Event = eventsTurn2.find(e => e.seq === turn1SysSeq)
    expect(preservedTurn1Event).toBeDefined()
    expect(preservedTurn1Event!.type).toBe('system/message')
    const preservedTurn1Content = (preservedTurn1Event as typeof sysEventsTurn1[0]).data.message.content
      .map(c => (c.type === 'text' ? c.text : ''))
      .join('\n')
    expect(preservedTurn1Content).toContain('Responsibility:\nDraft municipal water policies')
    expect(preservedTurn1Content).not.toContain('Review coastal wastewater permits')

    // Assert turn 2 system/message event has updated role text
    const latestSysEvent = sysEventsTurn2.at(-1)!
    const turn2SysContent = latestSysEvent.data.message.content
      .map(c => (c.type === 'text' ? c.text : ''))
      .join('\n')
    expect(turn2SysContent).toContain('Responsibility:\nReview coastal wastewater permits')
    expect(turn2SysContent).toContain('Instructions:\nInclude environmental impact score thresholds.')

    // Assert derived messages on turn 2 reflect updated profile
    const derivedTurn2 = lead.session.deriveMessages()
    const derivedSystemTurn2 = derivedTurn2.find(m => m.role === 'system')
    expect(derivedSystemTurn2).toBeDefined()
    const derivedTextTurn2 = derivedSystemTurn2!.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('\n')
    expect(derivedTextTurn2).toContain('Responsibility:\nReview coastal wastewater permits')
    expect(derivedTextTurn2).toContain('Instructions:\nInclude environmental impact score thresholds.')
  })

  it('does not inject role section into unbound agents', async () => {
    const script = [textResponse('unbound response')]
    harness = await setupAssistantHarness(script)
    const { assistants, lead } = harness

    // Profile exists, but lead is NOT bound to it
    await assistants.createProfile({
      name: 'Unbound Assistant',
      responsibility: 'Should not appear',
      instructions: 'Should not appear either',
    })

    sendUserText(lead, 'Hello unbound')
    await lead.whenIdle()

    const derived = lead.session.deriveMessages()
    const derivedSystem = derived.find(m => m.role === 'system')
    const derivedText = derivedSystem?.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('\n') ?? ''

    expect(derivedText).not.toContain('Unbound Assistant')
    expect(derivedText).not.toContain('Should not appear')
  })

  it('installs role injection on agents created after conversation binding or startup enumeration', async () => {
    const script = [textResponse('fresh agent response')]
    harness = await setupAssistantHarness(script)
    const { ctx, assistants } = harness

    const profile = await assistants.createProfile({
      name: 'Fresh Assistant',
      responsibility: 'Fresh agent duties',
    })

    const freshSessionId = SessionId('fresh-session-1')
    await assistants.createConversation(profile.id, freshSessionId)

    // Now create the agent through ctx.agents.create after the conversation binding already exists
    const handle = await ctx.agents.create({
      sessionId: freshSessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const agent = ctx.agents.get(freshSessionId)!
    expect(agent).toBeDefined()

    sendUserText(agent, 'Start fresh session')
    await agent.whenIdle()

    const derived = agent.session.deriveMessages()
    const derivedSystem = derived.find(m => m.role === 'system')
    expect(derivedSystem).toBeDefined()
    const derivedText = derivedSystem!.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('\n')

    expect(derivedText).toContain('You are Fresh Assistant.')
    expect(derivedText).toContain('Responsibility:\nFresh agent duties')

    await handle.dispose()
  })

  it('injects the role and team duty for a seat-bound agent without a private conversation', async () => {
    const script = [textResponse('seat member response')]
    harness = await setupAssistantHarness(script)
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: '资料员',
      responsibility: '整理机构资料',
    })
    const team = await assistants.createTeam({ name: '文书组', coordinatorProfileId: profile.id })
    const seat = await assistants.createSeat({
      teamId: team.id,
      profileId: profile.id,
      role: 'teammate',
      name: 'archivist',
      duty: '只收材料、建索引、列缺失项',
    })
    // No createConversation: the seat binding alone must carry the role section.
    await assistants.bindSeatSession(seat.id, lead.id)

    sendUserText(lead, '整理这批资料')
    await lead.whenIdle()

    const derived = lead.session.deriveMessages()
    const derivedSystem = derived.find(m => m.role === 'system')
    expect(derivedSystem).toBeDefined()
    const derivedText = derivedSystem!.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('\n')

    expect(derivedText).toContain('You are 资料员.')
    expect(derivedText).toContain('Responsibility:\n整理机构资料')
    expect(derivedText).toContain('Team duty:\n只收材料、建索引、列缺失项')
  })

  it('captures the application default model into a profile created without one', async () => {
    harness = await setupAssistantHarness([], {}, { withCatalog: true })
    const { assistants } = harness

    // The harness application default is provider 'mock', model 'mock'.
    const captured = await assistants.createProfile({ name: '默认助手', responsibility: '继承应用默认' })
    expect(captured.defaultModel).toEqual({ provider: 'mock', model: 'mock' })
    expect(harness.catalog!.getProfile(captured.id)?.defaultModel).toEqual({ provider: 'mock', model: 'mock' })

    const explicit = await assistants.createProfile({
      name: '显式助手',
      responsibility: '显式模型',
      defaultModel: { provider: 'mock', model: 'explicit' },
    })
    expect(explicit.defaultModel).toEqual({ provider: 'mock', model: 'explicit' })
  })
})
