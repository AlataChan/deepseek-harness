/** session transcript-audio remote: unavailable, workspace resolution, failure mapping. */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { createSessionTestController } from './test-remote.ts'
import {
  mapTranscriptAudioError,
  transcriptAudioFailureOf,
  type TranscriptAudioSeam,
} from '../src/index.ts'
import type { SessionImportTranscriptAudioRequest } from '../src/types.ts'
import { TRANSCRIPT_AUDIO_MAX_DECODED_BYTES } from '../src/types.ts'

class TranscriptAudioError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'TranscriptAudioError'
  }
}

function importRequest(): SessionImportTranscriptAudioRequest {
  return { filename: 'meeting.m4a', bytes: 'aGk=', sessionId: SessionId('s-1') }
}

function stagingStub(overrides: Partial<TranscriptAudioSeam> = {}): TranscriptAudioSeam {
  return {
    importAudio: () => Promise.resolve({ path: 'recordings/meeting.m4a', filename: 'meeting.m4a' }),
    ...overrides,
  }
}

async function harness(options: {
  staging?: TranscriptAudioSeam
  workspaces?: {
    get?: (id: string) => { path: string } | undefined
    list?: () => readonly { path: string; sessionIds: readonly string[] }[]
  }
  cwd?: string
} = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-transcript-audio-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.provide('workspaceRegistry', {
    get: options.workspaces?.get ?? (() => undefined),
    list: options.workspaces?.list ?? (() => []),
  } as never)
  if (options.staging !== undefined) ctx.provide('transcriptAudio', options.staging)
  if (options.cwd !== undefined) ctx.sessions.create(SessionId('s-1'), { meta: { cwd: options.cwd } })
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { controller, ctx }
}

describe('session transcript-audio remote', () => {
  it('fails without the overlay', async () => {
    const { controller } = await harness()
    await expect(controller.importTranscriptAudio(importRequest(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/transcript-audio-unavailable' })
  })

  it('stages into the explicitly named workspace', async () => {
    const roots: string[] = []
    const { controller } = await harness({
      staging: stagingStub({
        importAudio: (request, workspaceRoot) => {
          roots.push(workspaceRoot)
          return Promise.resolve({ path: `recordings/${request.filename}`, filename: request.filename })
        },
      }),
      workspaces: {
        get: id => (id === 'w-1' ? { path: '/ws/named', sessionIds: ['s-1'] } : undefined),
      },
    })
    await expect(controller.importTranscriptAudio(
      { ...importRequest(), workspaceId: 'w-1' },
      new AbortController().signal,
    )).resolves.toEqual({ path: 'recordings/meeting.m4a', filename: 'meeting.m4a' })
    expect(roots).toEqual(['/ws/named'])
  })

  it('falls back when the named workspace does not list the session', async () => {
    const roots: string[] = []
    const { controller } = await harness({
      staging: stagingStub({
        importAudio: (request, workspaceRoot) => {
          roots.push(workspaceRoot)
          return Promise.resolve({ path: `recordings/${request.filename}`, filename: request.filename })
        },
      }),
      workspaces: {
        get: id => (id === 'w-foreign' ? { path: '/ws/foreign', sessionIds: ['s-other'] } : undefined),
        list: () => [{ path: '/ws/owning', sessionIds: ['s-1'] }],
      },
    })
    await expect(controller.importTranscriptAudio(
      { ...importRequest(), workspaceId: 'w-foreign' },
      new AbortController().signal,
    )).resolves.toMatchObject({ filename: 'meeting.m4a' })
    expect(roots).toEqual(['/ws/owning'])
  })

  it('refuses an unknown named workspace', async () => {
    const { controller } = await harness({ staging: stagingStub() })
    await expect(controller.importTranscriptAudio(
      { ...importRequest(), workspaceId: 'w-missing' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'workspace/not-found' })
  })

  it('resolves the workspace owning the session, then the session cwd', async () => {
    const roots: string[] = []
    const capture = stagingStub({
      importAudio: (_request, workspaceRoot) => {
        roots.push(workspaceRoot)
        return Promise.resolve({ path: 'recordings/a.m4a', filename: 'a.m4a' })
      },
    })
    const owning = await harness({
      staging: capture,
      workspaces: { list: () => [{ path: '/ws/owning', sessionIds: ['s-1'] }] },
    })
    await owning.controller.importTranscriptAudio(importRequest(), new AbortController().signal)
    expect(roots).toEqual(['/ws/owning'])

    const cwd = await harness({ staging: capture, cwd: '/ws/cwd' })
    await cwd.controller.importTranscriptAudio(importRequest(), new AbortController().signal)
    expect(roots).toEqual(['/ws/owning', '/ws/cwd'])
  })

  it('fails when the session has no directory at all', async () => {
    const { controller } = await harness({ staging: stagingStub() })
    await expect(controller.importTranscriptAudio(importRequest(), new AbortController().signal))
      .rejects.toMatchObject({
        code: 'session/transcript-audio-failed',
        details: { code: 'workspace-missing' },
      })
  })

  it('rejects a non-canonical payload before touching the overlay', async () => {
    let called = false
    const { controller } = await harness({
      staging: stagingStub({
        importAudio: () => {
          called = true
          return Promise.resolve({ path: 'recordings/a.m4a', filename: 'a.m4a' })
        },
      }),
    })
    await expect(controller.importTranscriptAudio(
      { ...importRequest(), bytes: 'aGk' },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(called).toBe(false)
  })

  it('rejects a payload over the decoded cap', async () => {
    const { controller } = await harness({ staging: stagingStub(), cwd: '/ws/cwd' })
    const oversize = 'A'.repeat(Math.ceil((TRANSCRIPT_AUDIO_MAX_DECODED_BYTES + 1024) / 3) * 4)
    await expect(controller.importTranscriptAudio(
      { ...importRequest(), bytes: oversize },
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'session/transcript-audio-failed',
      details: { code: 'file-too-large', ruleId: 'file-size' },
    })
  })

  it('maps staging failures, pass-through failures, and cancellation', async () => {
    const typed = await harness({
      cwd: '/ws/cwd',
      staging: stagingStub({
        importAudio: () => Promise.reject(new TranscriptAudioError('too-large', '录音超过 64 MiB 上限')),
      }),
    })
    await expect(typed.controller.importTranscriptAudio(importRequest(), new AbortController().signal))
      .rejects.toMatchObject({
        code: 'session/transcript-audio-failed',
        message: '录音超过 64 MiB 上限',
        details: { code: 'too-large' },
      })

    const unknown = await harness({
      cwd: '/ws/cwd',
      staging: stagingStub({ importAudio: () => Promise.reject(new Error('boom')) }),
    })
    await expect(unknown.controller.importTranscriptAudio(importRequest(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/internal' })

    const chained = await harness({
      cwd: '/ws/cwd',
      staging: stagingStub({
        importAudio: () => Promise.reject(new RemoteError('gateway/internal', 'keep', {})),
      }),
    })
    await expect(chained.controller.importTranscriptAudio(importRequest(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'gateway/internal', message: 'keep' })

    const aborted = await harness({ cwd: '/ws/cwd', staging: stagingStub() })
    await expect(aborted.controller.importTranscriptAudio(importRequest(), AbortSignal.abort()))
      .rejects.toThrow()

    const midFlight = new AbortController()
    const during = await harness({
      cwd: '/ws/cwd',
      staging: stagingStub({
        importAudio: () => {
          midFlight.abort()
          return Promise.reject(new TranscriptAudioError('write-failed', '没能写入工作区录音文件。'))
        },
      }),
    })
    await expect(during.controller.importTranscriptAudio(importRequest(), midFlight.signal))
      .rejects.toMatchObject({ code: 'gateway/cancelled' })
  })
})

describe('transcript audio failure mapping', () => {
  it('recognizes only the overlay staging failure', () => {
    expect(transcriptAudioFailureOf(new TranscriptAudioError('too-large', 'big')))
      .toEqual({ code: 'too-large', message: 'big' })
    expect(transcriptAudioFailureOf('string')).toBeUndefined()
    expect(transcriptAudioFailureOf(null)).toBeUndefined()
    expect(transcriptAudioFailureOf(new Error('nope'))).toBeUndefined()
    expect(transcriptAudioFailureOf({})).toBeUndefined()
    expect(transcriptAudioFailureOf({ name: 'TranscriptAudioError' })).toBeUndefined()
    expect(transcriptAudioFailureOf({ name: 'TranscriptAudioError', code: 1, message: 'x' })).toBeUndefined()
    expect(transcriptAudioFailureOf({ name: 'TranscriptAudioError', code: 'x' })).toBeUndefined()
    expect(transcriptAudioFailureOf({ name: 'TranscriptAudioError', code: 'x', message: 1 })).toBeUndefined()
  })

  it('maps abort, RemoteError, typed, and unknown failures', () => {
    const live = new AbortController().signal
    expect(() => mapTranscriptAudioError(
      new TranscriptAudioError('too-large', 'big'), AbortSignal.abort(),
    )).toThrow(RemoteError)
    expect(() => mapTranscriptAudioError(
      new TranscriptAudioError('too-large', 'big'), live,
    )).toThrow(RemoteError)
    expect(() => mapTranscriptAudioError(
      new RemoteError('gateway/internal', 'keep', {}), live,
    )).toThrow(RemoteError)
    expect(() => mapTranscriptAudioError('string', live)).toThrow(RemoteError)
  })
})
