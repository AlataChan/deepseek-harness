import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import { recoverableRequests, recoverMediaJobs } from '../src/recovery.ts'
import { emptyMediaState } from '../src/projection.ts'
import { MediaRequestId } from '../src/ids.ts'
import type { MediaRequestRecord } from '../src/types.ts'

function request(partial: Partial<MediaRequestRecord> & { requestId: string }): MediaRequestRecord {
  return {
    kind: 'video',
    stage: 'running',
    label: 'pilot',
    inputHashes: [],
    estimatedYuan: 2.5,
    ...partial,
    requestId: MediaRequestId(partial.requestId),
  }
}

describe('recovery', () => {
  it('selects known provider tasks that are not stopped or complete', () => {
    const state = {
      requests: {
        a: request({ requestId: 'r_a', providerTaskId: 't1' }),
        b: request({ requestId: 'r_b', providerTaskId: 't2', stopIntent: true }),
        c: request({ requestId: 'r_c', providerTaskId: 't3', artifactId: 'a_1' as never }),
        d: request({ requestId: 'r_d', providerTaskId: 't4', stage: 'stopped' }),
        e: request({ requestId: 'r_e', providerTaskId: 't5', stage: 'failed' }),
        f: request({ requestId: 'r_f' }),
      },
      artifacts: {},
    }
    expect(recoverableRequests(state).map(row => row.requestId)).toEqual(['r_a'])
    expect(recoverableRequests(emptyMediaState())).toEqual([])
  })

  it('starts owned jobs and stops when the controller is missing', async () => {
    const owner = { session: { id: 's-1' } } as unknown as Agent
    const started: string[] = []
    const jobs = {
      start(input: { label: string }) {
        started.push(input.label)
        return 'job-1' as JobId
      },
    } as unknown as JobRegistry
    const ids = recoverMediaJobs(jobs, owner, {
      requests: {
        a: request({ requestId: 'r_a', providerTaskId: 't1', label: 'keep' }),
        b: request({ requestId: 'r_b', providerTaskId: 't1', label: 'dup' }),
      },
      artifacts: {},
    }, () => Promise.resolve('ok'))
    expect(ids).toEqual(['job-1'])
    expect(started).toEqual(['keep'])

    const missing = {
      start() { throw new Error('no job controller for owner') },
    } as unknown as JobRegistry
    expect(recoverMediaJobs(missing, owner, {
      requests: { a: request({ requestId: 'r_a', providerTaskId: 't1' }) },
      artifacts: {},
    }, () => Promise.resolve('ok'))).toEqual([])

    const other = {
      start() { throw new Error('boom') },
    } as unknown as JobRegistry
    expect(() => recoverMediaJobs(other, owner, {
      requests: { a: request({ requestId: 'r_a', providerTaskId: 't1' }) },
      artifacts: {},
    }, () => Promise.resolve('ok'))).toThrow('boom')

    let done: Promise<unknown> | undefined
    const withStop = {
      start(input: { run: () => { cancel: (reason?: string) => void; done: Promise<unknown> } }) {
        const hooks = input.run()
        hooks.cancel()
        done = hooks.done
        return 'job-2' as JobId
      },
    } as unknown as JobRegistry
    const stopped: string[] = []
    recoverMediaJobs(
      withStop,
      owner,
      {
        requests: { a: request({ requestId: 'r_a', providerTaskId: 't1' }) },
        artifacts: {},
      },
      signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      }),
      async (row) => { stopped.push(row.requestId) },
    )
    await done
    expect(stopped).toEqual(['r_a'])
  })
})
