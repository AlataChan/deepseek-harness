import { describe, expect, it } from 'vitest'
import { applyMediaEvent, emptyMediaState, mediaProjectionDefinition } from '../src/projection.ts'
import { MediaArtifactId, MediaRequestId } from '../src/ids.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { MediaArtifactRecord, MediaRequestRecord } from '../src/types.ts'

const request: MediaRequestRecord = {
  requestId: MediaRequestId('r_1'),
  kind: 'video',
  stage: 'approved',
  label: 'pilot',
  inputHashes: [],
  estimatedYuan: 2.5,
}

const artifact: MediaArtifactRecord = {
  artifactId: MediaArtifactId('a_1'),
  requestId: MediaRequestId('r_1'),
  kind: 'video',
  name: '样片.mp4',
  file: 'result.mp4',
  digest: 'aa',
  sessionId: SessionId('s-1'),
  createdAt: '2026-09-20T00:00:00.000Z',
}

describe('projection', () => {
  it('folds request, approval, task, artifact, stop, and unused events', () => {
    const empty = emptyMediaState()
    expect(applyMediaEvent(empty, { type: 'other', data: {} })).toBe(empty)
    const withRequest = applyMediaEvent(empty, { type: 'media/request', data: { request } })
    const approved = applyMediaEvent(withRequest, {
      type: 'media/approval',
      data: { requestId: 'r_1' },
    })
    expect(approved.requests.r_1?.stage).toBe('approved')
    expect(applyMediaEvent(empty, { type: 'media/approval', data: { requestId: 'missing' } })).toBe(empty)
    const running = applyMediaEvent(approved, {
      type: 'media/task',
      data: { requestId: 'r_1', providerTaskId: 'task-1' },
    })
    expect(running.requests.r_1?.providerTaskId).toBe('task-1')
    expect(applyMediaEvent(empty, { type: 'media/task', data: { requestId: 'missing', providerTaskId: 'x' } })).toBe(empty)
    const stopped = applyMediaEvent(withRequest, { type: 'media/stop', data: { requestId: 'r_1' } })
    const stoppedTask = applyMediaEvent(stopped, {
      type: 'media/task',
      data: { requestId: 'r_1', providerTaskId: 'task-2' },
    })
    expect(stoppedTask.requests.r_1?.stage).toBe('stopped')
    expect(applyMediaEvent(empty, { type: 'media/stop', data: { requestId: 'missing' } })).toBe(empty)
    const downloaded = applyMediaEvent(running, { type: 'media/artifact', data: { artifact } })
    expect(downloaded.artifacts.a_1?.artifactId).toBe('a_1')
    expect(downloaded.requests.r_1?.stage).toBe('downloaded')
    const composed = applyMediaEvent(empty, {
      type: 'media/artifact',
      data: { artifact: { ...artifact, kind: 'composed', requestId: MediaRequestId('r_missing') } },
    })
    expect(composed.artifacts.a_1?.kind).toBe('composed')
    const composedKnown = applyMediaEvent(withRequest, {
      type: 'media/artifact',
      data: { artifact: { ...artifact, kind: 'composed' } },
    })
    expect(composedKnown.requests.r_1?.stage).toBe('composed')
    expect(mediaProjectionDefinition.init()).toEqual(empty)
    expect(mediaProjectionDefinition.wire.view(empty)).toEqual(empty)
    expect(mediaProjectionDefinition.apply(empty, { type: 'other', data: {} } as never)).toBe(empty)
  })
})
