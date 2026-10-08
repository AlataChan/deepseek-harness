import { describe, expect, it } from 'vitest'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { isMissingJobController, mediaJobHooks, startMediaJob } from '../src/jobs.ts'
import { MediaError } from '../src/error.ts'

describe('jobs', () => {
  it('starts an owned media job and settles success, failure, and kill', async () => {
    const owner = 's-1' as SessionId
    let hooks: ReturnType<typeof mediaJobHooks> | undefined
    const jobs = {
      start(input: { run: () => ReturnType<typeof mediaJobHooks> }) {
        hooks = input.run()
        return 'job-1' as JobId
      },
    } as unknown as JobRegistry
    expect(startMediaJob({
      jobs,
      owner,
      label: 'pilot',
      work: () => Promise.resolve('ok'),
    })).toBe('job-1')
    await expect(hooks!.done).resolves.toEqual({ status: 'completed', output: 'ok' })

    const failed = mediaJobHooks(() => Promise.reject(new MediaError('task-failed', 'nope')))
    await expect(failed.done).resolves.toEqual({ status: 'failed', detail: 'nope' })
    const failedOther = mediaJobHooks(() => Promise.reject('string'))
    await expect(failedOther.done).resolves.toEqual({ status: 'failed', detail: 'string' })
    const failedError = mediaJobHooks(() => Promise.reject(new Error('boom')))
    await expect(failedError.done).resolves.toEqual({ status: 'failed', detail: 'boom' })
    const killed = mediaJobHooks(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    killed.cancel()
    await expect(killed.done).resolves.toMatchObject({ status: 'killed' })
    const killedReason = mediaJobHooks(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    killedReason.cancel('stop')
    await expect(killedReason.done).resolves.toMatchObject({ status: 'killed' })
    let stopped = 0
    const stoppedJob = mediaJobHooks(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }), async () => { stopped += 1 })
    stoppedJob.cancel()
    await expect(stoppedJob.done).resolves.toMatchObject({ status: 'killed' })
    expect(stopped).toBe(1)
    const failedStop = mediaJobHooks(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) })
    }), async () => { throw new Error('flush failed') })
    failedStop.cancel()
    await expect(failedStop.done).resolves.toMatchObject({
      status: 'killed',
      detail: expect.stringContaining('stop intent uncertain'),
    })
  })

  it('detects a missing job controller', () => {
    expect(isMissingJobController(new Error('no job controller attached'))).toBe(true)
    expect(isMissingJobController(new Error('other'))).toBe(false)
    expect(isMissingJobController('x')).toBe(false)
  })
})
