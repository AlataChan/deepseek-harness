import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { createSessionFormatV3ToV4, sessionFormatV3ToV4 } from '../src/index.ts'

const header: SessionFormatHeader = { version: 3, id: 'fork-events', createdAt: 1, isSeeded: false, delegationDepth: 0 }

function migrate(events: readonly SessionFormatEvent[], sourceHeader = header) {
  const stage = createSessionFormatV3ToV4([]).createStage({
    sourceHeader,
    targetHeader: sessionFormatV3ToV4.migrateHeader(sourceHeader),
    sourceInheritedEventCount: undefined,
    sourceKind: 'decoded',
  })
  const output = new SessionFormatEventCollector()
  for (const event of events) stage.transformEvent(event, output)
  return { events: output.values, cut: stage.finish(output) }
}

/**
 * Scrubbed minimal fork log: one turn carrying every event type this fork released while V3 was
 * current (ask-data/ask-knowledge/commerce/media) plus one team/member v2 record, with payload
 * shapes taken from real fork sessions (`ask-data/bound` etc. verified against live logs).
 */
const rows: SessionFormatEvent[] = [
  { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
  { type: 'ask-data/bound', seq: 2, time: 3, data: {
    sourceId: 'src-placeholder', connectionRef: 'ask-data:src-placeholder', displayName: 'user-data.csv', readonly: true } },
  { type: 'ask-knowledge/bound', seq: 3, time: 4, data: { libraryId: 'lib-placeholder', displayName: 'library' } },
  { type: 'ask-knowledge/unbound', seq: 4, time: 5, data: { libraryId: 'lib-placeholder' } },
  { type: 'commerce/bound', seq: 5, time: 6, data: {
    sourceId: 'src-placeholder', displayName: 'store', kinds: ['orders', 'products'] } },
  { type: 'media/request', seq: 6, time: 7, data: { version: 1, request: {
    requestId: 'media-request-placeholder', kind: 'video', stage: 'draft', label: 'clip',
    inputHashes: ['hash-placeholder'], estimatedYuan: 1 } } },
  { type: 'media/approval', seq: 7, time: 8, data: {
    version: 1, requestId: 'media-request-placeholder', inputHashes: ['hash-placeholder'],
    promptHash: 'hash-placeholder', estimatedYuan: 1 } },
  { type: 'media/task', seq: 8, time: 9, data: {
    version: 1, requestId: 'media-request-placeholder', providerTaskId: 'task-placeholder' } },
  { type: 'media/artifact', seq: 9, time: 10, data: { version: 1, artifact: {
    artifactId: 'artifact-placeholder', requestId: 'media-request-placeholder', kind: 'video',
    name: 'clip', file: 'clip.mp4', digest: 'digest-placeholder',
    sessionId: 'fork-events', createdAt: '2026-10-07T00:00:00.000Z' } } },
  { type: 'media/stop', seq: 10, time: 11, data: { version: 1, requestId: 'media-request-placeholder' } },
  { type: 'team/member', seq: 11, time: 12, data: {
    version: 2, teamId: 'fork-events', member: {
      id: 'member-placeholder', name: 'archivist', description: 'placeholder', provider: 'spawn',
      context: 'fresh', phase: 'active', model: 'model-placeholder' } } },
  { type: 'step/end', seq: 12, time: 13, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 13, time: 14, data: { turn: 1, reason: { kind: 'completed' } } },
]

describe('V3 to V4 fork event admission', () => {
  it('admits every fork-released required event type with payload, time, and order intact', () => {
    const before = structuredClone(rows)
    const { events, cut } = migrate(rows)
    expect(cut).toBe(0)
    expect(events).toHaveLength(rows.length)
    expect(events.map(event => event.type)).toEqual(rows.map(event => event.type))
    for (const [index, event] of events.entries()) {
      const source = rows[index]!
      expect(event.data).toEqual(source.data)
      expect(event.time).toBe(source.time)
      expect(event.seq).toBe(index)
    }
    expect(rows).toEqual(before)
  })

  it('admits the fork types through the frozen released-V3 vocabulary itself', async () => {
    const { RELEASED_V3_EVENT_TYPES } = await import('../src/extension-identities.ts')
    for (const type of ['ask-data/bound', 'ask-knowledge/bound', 'ask-knowledge/unbound', 'commerce/bound',
      'media/approval', 'media/artifact', 'media/request', 'media/stop', 'media/task', 'team/member']) {
      expect(RELEASED_V3_EVENT_TYPES.has(type)).toBe(true)
    }
  })
})
