/** Five surfaces and the model paragraph each name every limits.ts rule id. */

import { describe, expect, it } from 'vitest'
import { ASK_DATA_RULE_IDS, isAskDataRuleId } from '../src/limits.ts'
import { renderAskDataLimitsPrompt } from '../src/prompt-limits.ts'

describe('ask-data limit surfaces', () => {
  it('exports the closed id set', () => {
    expect(isAskDataRuleId('file-size')).toBe(true)
    expect(isAskDataRuleId('not-a-rule')).toBe(false)
  })

  it('puts every rule id in the model-visible paragraph', () => {
    const prompt = renderAskDataLimitsPrompt()
    for (const id of ASK_DATA_RULE_IDS) {
      expect(prompt).toContain(id)
    }
  })

  it('reassembles the same paragraph after a cold projection fold', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { default: SessionStore } = await import('@deepseek-ai/dsh-session')
    const { default: SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection')
    const { askDataBindingProjectionDefinition } = await import('@deepseek-ai/dsh-host-ask-data')
    const { SessionId } = await import('@deepseek-ai/dsh-session')
    const bound = {
      sourceId: 'src-sample',
      connectionRef: 'ask-data:src-sample',
      displayName: '示例：销售明细',
      readonly: true,
    }
    const first = new Context()
    await first.plugin(SessionStore)
    await first.plugin(SessionProjectionRegistry)
    first.sessionProjections.register(askDataBindingProjectionDefinition)
    const session = first.sessions.create(SessionId('s-cold'))
    session.append('ask-data/bound', bound)
    const firstText = renderAskDataLimitsPrompt()
    expect(first.sessionProjections.stateOf(session, 'askDataBinding')).toEqual(bound)
    expect(Object.keys(bound)).toEqual(['sourceId', 'connectionRef', 'displayName', 'readonly'])
    const events = [...session.snapshotEvents()]
    await first.fiber.dispose()

    const second = new Context()
    await second.plugin(SessionStore)
    await second.plugin(SessionProjectionRegistry)
    second.sessionProjections.register(askDataBindingProjectionDefinition)
    const restored = second.sessions.create(SessionId('s-cold'), { seed: events })
    expect(second.sessionProjections.stateOf(restored, 'askDataBinding')).toEqual(bound)
    expect(renderAskDataLimitsPrompt()).toBe(firstText)
    for (const id of ASK_DATA_RULE_IDS) {
      expect(firstText).toContain(id)
    }
    expect(JSON.stringify(events.find(event => event.type === 'ask-data/bound')?.data)).not.toContain('accept-xlsx-csv')
  })
})
