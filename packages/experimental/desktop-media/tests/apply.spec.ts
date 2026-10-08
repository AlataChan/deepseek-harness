import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import * as plugin from '../src/index.ts'
import { MEDIA_CREATION_PROMPT } from '../src/prompt.ts'
import { mediaProjectionDefinition } from '../src/projection.ts'

describe('host apply', () => {
  it('registers projection, prompt, tools, and recovers on agent/created', () => {
    const ctx = new Context()
    const registered: unknown[] = []
    const sections: Array<{ name: string; text: () => string }> = []
    const started: string[] = []
    ctx.provide('sessionProjections', {
      register(definition: unknown) {
        registered.push(definition)
        return () => {}
      },
      stateOf() {
        return {
          requests: {
            a: {
              requestId: 'r_a',
              kind: 'speech',
              stage: 'running',
              label: 'keep',
              inputHashes: [],
              estimatedYuan: 0.01,
              providerTaskId: 't1',
            },
          },
          artifacts: {},
        }
      },
    })
    ctx.provide('systemPrompt', {
      section(entry: { name: string; text: () => string }) {
        sections.push(entry)
        return () => {}
      },
    })
    ctx.provide('tools', {
      register() { return () => {} },
    })
    ctx.provide('jobs', {
      start(input: { label: string }) {
        started.push(input.label)
        return 'job-1' as JobId
      },
    })
    const config = { ...plugin.Config({} as never) }
    delete config.mediaRuntimePath
    plugin.apply(ctx, config)
    expect(registered).toContain(mediaProjectionDefinition)
    expect(sections[0]?.name).toBe('desktop-media:creation')
    expect(sections[0]?.text()).toBe(MEDIA_CREATION_PROMPT)

    const owner = { session: { id: 's-1' } } as unknown as Agent
    ctx.emit('agent/created', { agent: owner, source: 'resume' })
    expect(started).toEqual(['keep'])
  })

  it('skips optional seams and still recovers with no jobs', () => {
    const ctx = new Context()
    plugin.apply(ctx, plugin.Config({} as never))
    ctx.emit('agent/created', { agent: { session: { id: 's-1' } } as never, source: 'resume' })
    expect(plugin.name).toBe('experimental-desktop-media')
    expect(plugin.inject).toEqual(['tools', 'jobs', 'sessionProjections', 'systemPrompt', 'sessions'])
    expect(plugin.Config).toBeDefined()
  })
})
