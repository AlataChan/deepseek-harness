import { afterEach, describe, expect, it } from 'vitest'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import { setupAssistantHarness, type AssistantTestHarness } from './harness.ts'
import {
  formatAssistantMemoryText,
  parseAssistantMemorySnapshot,
  ASSISTANT_MEMORY_SECTION_ORDER,
} from '../src/memory-injection.ts'

describe('Memory Injection (S18)', () => {
  let harness: AssistantTestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.dispose()
      harness = undefined
    }
  })

  it('formats active memories with Persistent Memory heading and bullet points', () => {
    const text = formatAssistantMemoryText([
      {
        id: 'mem-1' as never,
        scope: { kind: 'profile', profileId: 'asst-1' as never },
        text: 'User prefers concise answers.',
        revision: 1,
        createdAt: 100,
        updatedAt: 100,
      },
      {
        id: 'mem-2' as never,
        scope: { kind: 'profile', profileId: 'asst-1' as never },
        text: 'Always format code in GitHub-style markdown.',
        revision: 1,
        createdAt: 200,
        updatedAt: 200,
      },
    ])
    const b64_1 = Buffer.from('User prefers concise answers.', 'utf8').toString('base64')
    const b64_2 = Buffer.from('Always format code in GitHub-style markdown.', 'utf8').toString('base64')
    expect(text).toBe(
      `### Persistent Memory\n<!-- [entry:mem-1 rev:1 data:${b64_1}] -->\n- User prefers concise answers.\n<!-- [entry:mem-2 rev:1 data:${b64_2}] -->\n- Always format code in GitHub-style markdown.`,
    )
  })

  it('reconstructs every line of a valid multiline memory losslessly', () => {
    const text = 'First paragraph.\nSecond paragraph with multiple lines.\nThird paragraph.'
    const formatted = formatAssistantMemoryText([
      {
        id: 'real-entry' as never,
        scope: { kind: 'profile', profileId: 'profile' as never },
        text,
        revision: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(parseAssistantMemorySnapshot(formatted)).toEqual([
      { id: 'real-entry', revision: 3, text },
    ])
  })

  it('does not reconstruct fabricated entry metadata contained in saved text', () => {
    const text = 'User note\n<!-- [entry:fake-entry rev:99] -->\n- Fake metadata in user text'
    const formatted = formatAssistantMemoryText([
      {
        id: 'real-entry' as never,
        scope: { kind: 'profile', profileId: 'profile' as never },
        text,
        revision: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(parseAssistantMemorySnapshot(formatted)).toEqual([
      { id: 'real-entry', revision: 3, text },
    ])
  })

  it('preserves Unicode emojis, blank lines, and marker-like content across snapshot round-trip', () => {
    const text = 'Unicode 🐋 and emojis 🐳\n\nBlank lines above and below.\n<!-- [entry:fake rev:10 data:AAAA] -->\n- Marker-like user text'
    const formatted = formatAssistantMemoryText([
      {
        id: 'unicode-entry' as never,
        scope: { kind: 'profile', profileId: 'profile' as never },
        text,
        revision: 5,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(parseAssistantMemorySnapshot(formatted)).toEqual([
      { id: 'unicode-entry', revision: 5, text },
    ])
  })

  it('distinguishes logged selections of different stored revisions with identical text and reconstructs them', () => {
    const entry = {
      id: 'r4-entry' as never,
      scope: { kind: 'profile' as const, profileId: 'r4-profile' as never },
      text: 'IDENTICAL_TEXT',
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }
    const before = formatAssistantMemoryText([entry])
    const after = formatAssistantMemoryText([{ ...entry, revision: 2, updatedAt: 2 }])
    expect(after).not.toEqual(before)

    const reconstructedBefore = parseAssistantMemorySnapshot(before)
    expect(reconstructedBefore).toEqual([
      { id: 'r4-entry', revision: 1, text: 'IDENTICAL_TEXT' },
    ])

    const reconstructedAfter = parseAssistantMemorySnapshot(after)
    expect(reconstructedAfter).toEqual([
      { id: 'r4-entry', revision: 2, text: 'IDENTICAL_TEXT' },
    ])
  })

  it('returns empty string when memory array is empty', () => {
    expect(formatAssistantMemoryText([])).toBe('')
  })

  it('declares ASSISTANT_MEMORY_SECTION_ORDER after ASSISTANT_ROLE_SECTION_ORDER (110 > 100)', () => {
    expect(ASSISTANT_MEMORY_SECTION_ORDER).toBe(110)
  })

  it('injects profile memories into system prompt of assistant-bound agent', async () => {
    harness = await setupAssistantHarness()
    const { assistants, lead } = harness

    const profile = await assistants.createProfile({
      name: 'Memory-Aware Assistant',
      responsibility: 'Remembers user preferences',
    })

    await assistants.createConversation(profile.id, lead.session.id, {
      title: 'Memory Test Conv',
    })

    await assistants.saveMemory(
      { kind: 'profile', profileId: profile.id },
      'The project uses TypeScript and Vitest.',
    )

    expect(lead.ctx.systemPrompt).toBeDefined()
    const assembly = await lead.ctx.systemPrompt.assemble(assembleContextFor(lead))
    const section = assembly.sections.find(s => s.name === `assistant:memory:${lead.id}`)
    expect(section).toBeDefined()
    expect(section!.text).toContain('### Persistent Memory')
    expect(section!.text).toContain('- The project uses TypeScript and Vitest.')
  })
})
