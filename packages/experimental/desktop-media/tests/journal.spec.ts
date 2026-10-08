import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendMediaEvent } from '../src/journal.ts'
import { MediaRequestId } from '../src/ids.ts'

describe('journal', () => {
  it('appends and optionally flushes', async () => {
    const events: unknown[] = []
    const flushed: unknown[] = []
    const agent = {
      session: {
        append(type: string, data: unknown) { events.push({ type, data }) },
      },
    } as unknown as Agent
    await appendMediaEvent(agent, 'media/stop', { version: 1, requestId: MediaRequestId('r_1') })
    await appendMediaEvent(agent, 'media/stop', { version: 1, requestId: MediaRequestId('r_2') }, (session) => {
      flushed.push(session)
      return Promise.resolve()
    })
    expect(events).toHaveLength(2)
    expect(flushed).toHaveLength(1)
  })
})
