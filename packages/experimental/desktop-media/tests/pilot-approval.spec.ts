import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MediaError } from '../src/error.ts'
import { MediaRequestId } from '../src/ids.ts'
import { DesktopMedia, optionalHostSeam, type DesktopMediaConfig } from '../src/service.ts'

const config: DesktopMediaConfig = {
  mediaRuntimePath: '',
  maxPaidCallsPerSession: 8,
  maxEstimatedSpendYuan: 40,
  maxClipCount: 4,
  maxClipDurationSeconds: 15,
  maxFileBytes: 20 * 1024 * 1024,
  pollIntervalMs: 1,
  pollTimeoutMs: 50,
  videoModel: 'MiniMax-H3-Max',
  ttsModel: 'speech-2.8-hd',
  defaultDurationSeconds: 5,
  defaultResolution: '768P',
  defaultRatio: '16:9',
}

const approved = {
  requestId: MediaRequestId('r_1'),
  kind: 'video' as const,
  stage: 'approved' as const,
  label: 'pilot',
  inputHashes: ['aa'],
  promptHash: 'p1',
  estimatedYuan: 2.5,
}

function owner(): Agent {
  return { session: { id: 's-1', append() {} } } as unknown as Agent
}

function mediaWith(state: { requests: Record<string, typeof approved> }): DesktopMedia {
  const ctx = new Context()
  ctx.provide('sessionProjections', {
    stateOf: () => ({ requests: state.requests, artifacts: {} }),
  })
  return new DesktopMedia(ctx, config)
}

describe('pilot approval', () => {
  it('blocks a later paid call when the stored hashes changed', async () => {
    const media = mediaWith({ requests: { r_1: approved } })
    const args = {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9' as const,
      resolution: '768P' as const,
      model: 'MiniMax-H3-Max' as const,
    }
    await expect(media.createVideo(owner(), args, {
      promptHash: 'changed',
      estimatedYuan: 2.5,
      inputHashes: ['aa'],
      requestId: 'r_1',
    })).rejects.toMatchObject({ code: 'approval-mismatch' })
    await expect(media.createVideo(owner(), args, {
      promptHash: 'p1',
      estimatedYuan: 2.5,
      inputHashes: ['bb'],
      requestId: 'r_1',
    })).rejects.toMatchObject({ code: 'approval-mismatch' })
    await expect(media.createVideo(owner(), args, {
      promptHash: 'p1',
      estimatedYuan: 2.5,
      inputHashes: ['aa'],
      requestId: 'missing',
    })).rejects.toMatchObject({ code: 'approval-required' })
  })

  it('reuses an unchanged stored approval', async () => {
    const ctx = new Context()
    ctx.provide('sessionProjections', {
      stateOf: () => ({ requests: { r_1: approved }, artifacts: {} }),
    })
    ctx.provide('jobs', {
      start() { throw new Error('no job controller attached') },
    })
    const media = new DesktopMedia(ctx, config)
    await expect(media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, {
      promptHash: 'p1',
      estimatedYuan: 2.5,
      inputHashes: ['aa'],
      requestId: 'r_1',
    })).rejects.toMatchObject({ code: 'task-failed' })
  })

  it('reads optional seams from the current context', () => {
    const root = new Context()
    root.provide('jobs', { start() { return 'job-1' } })
    expect(optionalHostSeam<{ start: () => string }>(root, 'jobs')?.start()).toBe('job-1')
    expect(optionalHostSeam(root, 'missing-seam')).toBeUndefined()
    expect(MediaError).toBeDefined()
  })
})
