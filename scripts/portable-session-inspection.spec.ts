import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertInstructionChainBudgets } from '../snapshots/session/instruction-chain-budgets/inspect.ts'
import { assertSkillRootIsolation } from '../snapshots/session/skill-root-isolation/inspect.ts'

const instructionLog = fileURLToPath(new URL('../snapshots/session/instruction-chain-budgets/session.v4.jsonl', import.meta.url))
const skillLog = fileURLToPath(new URL('../snapshots/session/skill-root-isolation/session.v4.jsonl', import.meta.url))

function instructionLine(text: string, baseline: boolean): string {
  return JSON.stringify({
    type: 'user/message',
    data: {
      id: baseline ? 'baseline' : 'update',
      content: [{ type: 'text', text }],
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        baseline,
        changes: baseline
          ? [
            { action: 'set', path: '$DSH_HOME/AGENTS.md', digest: 'unused' },
            { action: 'set', path: 'AGENTS.md', digest: 'unused' },
          ]
          : [],
      },
      role: 'user',
    },
  })
}

const baselineText = [
  '<system-reminder>',
  'Instructions from: $DSH_HOME/AGENTS.md',
  '',
  'user-global',
  '',
  'Instructions from: AGENTS.md',
  '',
  'project',
  '</system-reminder>',
].join('\n')

describe('portable session inspection', () => {
  it('rejects a log that never records either instruction chain', () => {
    const done = JSON.stringify({
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'DONE' }] } },
    })
    expect(() => {
      assertInstructionChainBudgets(`${done}\n`)
    }).toThrow('missing instruction chain')
  })

  it('rejects a baseline that never receives the later chain update', () => {
    expect(() => {
      assertInstructionChainBudgets(`${instructionLine(baselineText, true)}\n`)
    })
      .toThrow('missing instruction update')
  })

  it('compares the harvested instruction update with its inbox copy', async () => {
    const log = await readFile(instructionLog, 'utf8')
    expect(() => {
      assertInstructionChainBudgets(log)
    }).not.toThrow()
    const events = log.trim().split('\n').map(line => JSON.parse(line) as {
      type?: string
      data?: { inserted?: { id?: string; content?: { text?: string }[] }[] }
    })
    const splice = events.find(event => event.type === 'agent/inbox/spliced'
      && event.data?.inserted?.some(item => item.id === '{{message:12}}'))
    const inserted = splice?.data?.inserted?.find(item => item.id === '{{message:12}}')
    const block = inserted?.content?.[0]
    if (block?.text === undefined) throw new Error('harvested update splice is missing')
    block.text = `${block.text}\nchanged`
    expect(() => {
      assertInstructionChainBudgets(`${events.map(event => JSON.stringify(event)).join('\n')}\n`)
    })
      .toThrow('model-visible text differs from the logged instruction message')
    const withoutCopy = log.trim().split('\n').map(line => JSON.parse(line) as {
      type?: string
      data?: { inserted?: { id?: string }[] }
    })
    const update = withoutCopy.find(event => event.type === 'agent/inbox/spliced'
      && event.data?.inserted?.some(item => item.id === '{{message:12}}'))
    if (update?.data?.inserted === undefined) throw new Error('harvested update splice is missing')
    update.data.inserted = update.data.inserted.filter(item => item.id !== '{{message:12}}')
    expect(() => {
      assertInstructionChainBudgets(`${withoutCopy.map(event => JSON.stringify(event)).join('\n')}\n`)
    })
      .toThrow('model-visible instruction update has no logged inbox copy')
    const echoed = log.trim().split('\n').map(line => JSON.parse(line) as {
      type?: string
      data?: { message?: { content?: { type?: string; text?: string }[] } }
    })
    let changedEcho = false
    for (const event of echoed) {
      if (event.type !== 'assistant/message') continue
      for (const block of event.data?.message?.content ?? []) {
        if (block.type !== 'text' || block.text?.startsWith('<system-reminder>') !== true) continue
        block.text = `${block.text}\nchanged`
        changedEcho = true
        break
      }
      if (changedEcho) break
    }
    expect(changedEcho).toBe(true)
    expect(() => {
      assertInstructionChainBudgets(`${echoed.map(event => JSON.stringify(event)).join('\n')}\n`)
    })
      .toThrow('model request echo does not match the logged instruction frame')
  })

  it('rejects a shared-skill body that is not the project-agents skill', async () => {
    const log = await readFile(skillLog, 'utf8')
    expect(() => {
      assertSkillRootIsolation(log)
    }).not.toThrow()
    const events = log.trim().split('\n').map(line => JSON.parse(line) as {
      data?: { message?: { content?: { text?: string }[] } }
    })
    const marker = '<skill_instructions>\nPROJECT_AGENTS_BODY\n'
    let changed = false
    for (const event of events) {
      for (const block of event.data?.message?.content ?? []) {
        if (block.text?.includes(marker) !== true) continue
        block.text = block.text.replace(marker, '<skill_instructions>\nNOT_THE_PROJECT_AGENTS_BODY\n')
        changed = true
        break
      }
      if (changed) break
    }
    expect(changed).toBe(true)
    const replaced = `${events.map(event => JSON.stringify(event)).join('\n')}\n`
    expect(() => {
      assertSkillRootIsolation(replaced)
    }).toThrow(/^wrong skill body$/)
  })
})
