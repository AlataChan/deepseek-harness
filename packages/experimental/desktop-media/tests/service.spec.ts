import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobHooks, JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { artifactFilePath } from '../src/admission.ts'
import { upsertVoice, upsertWork } from '../src/catalogue.ts'
import { MediaArtifactId, MediaRequestId, MediaVoiceId } from '../src/ids.ts'
import { createMinimaxTransport } from '../src/provider.ts'
import { DesktopMedia, type DesktopMediaConfig } from '../src/service.ts'
import type { MediaArtifactRecord } from '../src/types.ts'

vi.mock('../src/local-open.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/local-open.ts')>('../src/local-open.ts')
  return {
    ...actual,
    openMediaFile: vi.fn(async () => undefined),
    revealMediaFile: vi.fn(async () => undefined),
  }
})

vi.mock('../src/compositor.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/compositor.ts')>('../src/compositor.ts')
  return {
    ...actual,
    composeAudiovisual: vi.fn(async (request: { outputPath: string; clips: { id: string }[] }) => {
      await writeFile(request.outputPath, 'composed')
      return {
        outputPath: request.outputPath,
        durationSeconds: 1,
        clipIds: request.clips.map(clip => clip.id),
      }
    }),
  }
})

const previousHome = process.env.DSH_HOME
const previousOctopus = process.env.OCTOPUS_MEDIA_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousOctopus === undefined) delete process.env.OCTOPUS_MEDIA_HOME
  else process.env.OCTOPUS_MEDIA_HOME = previousOctopus
})

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function owner(sessionId = 's-1'): Agent {
  return {
    session: {
      id: sessionId,
      append() {},
    },
  } as unknown as Agent
}

function jobsCapture() {
  let hooks: JobHooks | undefined
  return {
    hooks: () => hooks,
    service: {
      start(input: { run: () => JobHooks }) {
        hooks = input.run()
        return 'job-1' as JobId
      },
    },
  }
}

function work(id: string, extra: Partial<MediaArtifactRecord> = {}): MediaArtifactRecord {
  return {
    artifactId: MediaArtifactId(id),
    requestId: MediaRequestId('r_1'),
    kind: 'import',
    name: 'clip.mp4',
    file: 'source.mp4',
    digest: 'aa',
    sessionId: SessionId('s-1'),
    createdAt: '2026-09-20T00:00:00.000Z',
    ...extra,
  }
}

function transportFor(kind: 'video' | 'speech' | 'clone' | 'video-no-url') {
  return createMinimaxTransport({
    apiKey: 'k',
    baseUrl: 'https://api.example.test/',
    now: () => 0,
    sleep: async () => undefined,
    fetch: (async (input) => {
      const url = String(input)
      if (url.includes('/v2/video_generation') && !url.includes('/query/')) {
        return jsonResponse({ task_id: 'task-1' })
      }
      if (url.includes('/query/video_generation/')) {
        return jsonResponse({
          task: {
            id: 'task-1',
            status: 'succeeded',
            ...kind === 'video-no-url' ? {} : { content: { url: 'https://cdn.example/out.mp4' } },
          },
        })
      }
      if (url.includes('cdn.example/out.mp4')) {
        return new Response(Buffer.from('mp4'), { status: 200 })
      }
      if (url.includes('t2a_v2')) {
        return jsonResponse({
          data: { audio: '4d5033' },
          extra_info: { usage_characters: 1 },
          base_resp: { status_code: 0 },
        })
      }
      if (url.includes('/v1/files/upload')) {
        return jsonResponse({ file: { file_id: 9 }, base_resp: { status_code: 0 } })
      }
      if (url.includes('/v1/voice_clone')) {
        return jsonResponse({ base_resp: { status_code: 0 } })
      }
      return jsonResponse({})
    }) as typeof fetch,
  })
}

async function bench(options: {
  jobs?: { start: (input: { run: () => JobHooks }) => JobId }
  internals?: ConstructorParameters<typeof DesktopMedia>[2]
  projections?: { stateOf: () => unknown }
  credentials?: { resolve: () => Promise<{ value: string; source: string } | undefined> }
  config?: Partial<DesktopMediaConfig>
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-media-service-'))
  process.env.DSH_HOME = root
  delete process.env.OCTOPUS_MEDIA_HOME
  const ctx = new Context()
  if (options.jobs !== undefined) ctx.provide('jobs', options.jobs)
  if (options.projections !== undefined) ctx.provide('sessionProjections', options.projections)
  if (options.credentials !== undefined) ctx.provide('credentials', options.credentials)
  const media = new DesktopMedia(ctx, { ...config, ...options.config }, options.internals ?? {})
  return { ctx, media, root, env: { DSH_HOME: root } }
}

describe('DesktopMedia', () => {
  it('reports runtime from the inject, a missing home, a failed probe, and a ready fake binary', async () => {
    const injected = await bench({
      internals: {
        runtimeReady: async () => ({ ready: true, homeDisplay: '$DSH_HOME/media', guidance: '' }),
      },
    })
    await expect(injected.media.runtimeStatus(new AbortController().signal))
      .resolves.toMatchObject({ ready: true })

    const missing = await bench()
    await expect(missing.media.runtimeStatus(new AbortController().signal)).resolves.toMatchObject({
      ready: false,
      guidance: 'run scripts/install-media-runtime.sh',
    })

    const failed = await bench({ config: { mediaRuntimePath: '/tmp/missing-media-runtime' } })
    await expect(failed.media.runtimeStatus(new AbortController().signal)).resolves.toMatchObject({
      ready: false,
      guidance: 'FFmpeg is missing h264_videotoolbox or aac',
    })

    const runtime = await mkdtemp(join(tmpdir(), 'desktop-media-ffmpeg-'))
    const bin = join(runtime, 'bin')
    await mkdir(bin, { recursive: true })
    const ffmpeg = join(bin, 'ffmpeg')
    await writeFile(ffmpeg, '#!/bin/sh\necho " V..... h264_videotoolbox"\necho " A..... aac"\n')
    await chmod(ffmpeg, 0o755)
    const ready = await bench({ config: { mediaRuntimePath: runtime } })
    await expect(ready.media.runtimeStatus(new AbortController().signal))
      .resolves.toMatchObject({ ready: true, guidance: '' })
  })

  it('lists, imports, opens, reveals, copies, and saves works', async () => {
    const { media, root, env } = await bench()
    const artifact = await media.importBytes({
      filename: '旁白.mp3',
      bytes: new Uint8Array([1, 2, 3]),
    }, 's-1', 'w-1')
    expect(artifact.workspaceId).toBe('w-1')
    expect(await media.listWorks({ sessionId: 's-1' })).toHaveLength(1)
    expect(await media.listVoices()).toEqual(expect.arrayContaining([
      expect.objectContaining({ voiceId: 'male-qn-qingse' }),
    ]))
    await expect(media.openWork(artifact.artifactId, new AbortController().signal))
      .resolves.toMatchObject({ requested: true })
    await expect(media.revealWork(artifact.artifactId, new AbortController().signal))
      .resolves.toMatchObject({ requested: true })
    await expect(media.copyWorkPath(artifact.artifactId))
      .resolves.toMatchObject({ path: expect.stringContaining(artifact.artifactId) })
    const dest = join(root, 'out')
    await mkdir(dest)
    await expect(media.saveWorkAs(artifact.artifactId, dest, 'saved.mp3'))
      .resolves.toMatchObject({ path: join(dest, 'saved.mp3') })
    await expect(media.saveWorkAs(artifact.artifactId, dest, 'saved.mp3'))
      .rejects.toMatchObject({ code: 'save-as-exists' })
    const notDir = join(root, 'not-a-dir')
    await writeFile(notDir, 'x')
    await expect(media.saveWorkAs(artifact.artifactId, notDir, 'x.mp3')).rejects.toBeTruthy()
    await expect(media.saveWorkAs(artifact.artifactId, 'rel', 'a.mp3'))
      .rejects.toMatchObject({ code: 'path-not-absolute' })
    await expect(media.saveWorkAs(artifact.artifactId, dest, '')).rejects.toMatchObject({
      code: 'import-rejected',
    })
    await expect(media.saveWorkAs(artifact.artifactId, dest, '.')).rejects.toMatchObject({
      code: 'import-rejected',
    })
    await expect(media.saveWorkAs(artifact.artifactId, dest, '..')).rejects.toMatchObject({
      code: 'import-rejected',
    })
    await expect(media.saveWorkAs(artifact.artifactId, dest, 'a/b.mp3')).rejects.toMatchObject({
      code: 'import-rejected',
    })
    await expect(media.saveWorkAs(artifact.artifactId, dest, 'a\\b.mp3')).rejects.toMatchObject({
      code: 'import-rejected',
    })
    await expect(media.openWork('missing', new AbortController().signal))
      .rejects.toMatchObject({ code: 'artifact-missing' })
    expect(env.DSH_HOME).toBe(root)
  })

  it('creates video and speech jobs and persists artifacts', async () => {
    const videoJobs = jobsCapture()
    const { media } = await bench({
      jobs: videoJobs.service,
      internals: {
        transport: transportFor('video'),
        flush: async () => undefined,
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      },
    })
    const created = await media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })
    expect(created.jobId).toBe('job-1')
    await expect(videoJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })

    const emptyImageJobs = jobsCapture()
    const emptyImages = await bench({
      jobs: emptyImageJobs.service,
      internals: {
        transport: transportFor('video'),
        flush: async () => undefined,
      },
    })
    await emptyImages.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: [],
    }, { promptHash: 'p-empty', estimatedYuan: 2.5 })
    await expect(emptyImageJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })

    const speechJobs = jobsCapture()
    const speech = await bench({
      jobs: speechJobs.service,
      internals: {
        transport: transportFor('speech'),
        flush: async () => undefined,
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      },
    })
    await upsertVoice({
      voiceId: MediaVoiceId('male-qn-qingse'),
      label: '青涩男声',
      system: true,
    }, { DSH_HOME: speech.root })
    await expect(speech.media.createSpeech(owner(), '你好', 'missing', {
      promptHash: 'p2',
      estimatedYuan: 0.01,
    })).rejects.toMatchObject({ code: 'voice-unavailable' })
    const spoken = await speech.media.createSpeech(owner(), '你好', 'male-qn-qingse', {
      promptHash: 'p2',
      estimatedYuan: 0.01,
    })
    expect(spoken.requestId).toMatch(/^r_/)
    await expect(speechJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
    expect((await speech.media.listVoices()).some(row => row.lastFormalAt !== undefined)).toBe(true)

    const goneJobs = jobsCapture()
    const gone = await bench({
      jobs: goneJobs.service,
      internals: {
        transport: createMinimaxTransport({
          apiKey: 'k',
          baseUrl: 'https://api.example.test/',
          now: () => 0,
          sleep: async () => undefined,
          fetch: (async (input) => {
            if (String(input).includes('t2a')) {
              await writeFile(join(gone.root, 'media/catalog/voices.json'), `${JSON.stringify({
                version: 1,
                voices: [{ voiceId: 'male-qn-qingse', label: '青涩男声', system: true }],
              })}\n`)
              return jsonResponse({
                data: { audio: '4d5033' },
                extra_info: { usage_characters: 1 },
                base_resp: { status_code: 0 },
              })
            }
            return jsonResponse({})
          }) as typeof fetch,
        }),
        flush: async () => undefined,
      },
    })
    await upsertVoice({
      voiceId: MediaVoiceId('custom-v'),
      label: 'custom',
      system: false,
    }, { DSH_HOME: gone.root })
    await gone.media.createSpeech(owner(), '你好', 'custom-v', {
      promptHash: 'p-gone',
      estimatedYuan: 0.01,
    })
    await expect(goneJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
  })

  it('sends imported stills and inherits workspace on generated works', async () => {
    const videoJobs = jobsCapture()
    const { media } = await bench({
      jobs: videoJobs.service,
      internals: {
        transport: transportFor('video'),
        flush: async () => undefined,
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      },
    })
    const first = await media.importBytes({
      filename: 'a.png',
      bytes: new Uint8Array([1, 2, 3]),
    }, 's-1', 'w-1')
    const last = await media.importBytes({
      filename: 'b.jpg',
      bytes: new Uint8Array([4, 5, 6]),
    }, 's-1', 'w-1')
    await expect(media.createVideo(owner(), {
      prompt: 'Walk from A to B.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: [first.artifactId],
      imageMode: 'first_last',
    }, { promptHash: 'p-img', estimatedYuan: 2.5 })).rejects.toMatchObject({
      code: 'image-mode-conflict',
    })
    await expect(media.createVideo(owner(), {
      prompt: 'Walk from A to B.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: ['missing'],
    }, { promptHash: 'p-img', estimatedYuan: 2.5 })).rejects.toMatchObject({
      code: 'artifact-missing',
    })
    const created = await media.createVideo(owner(), {
      prompt: 'Walk from A to B.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: [first.artifactId, last.artifactId],
      imageMode: 'first_last',
    }, { promptHash: 'p-img', estimatedYuan: 2.5 })
    expect(created.jobId).toBe('job-1')
    await expect(videoJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
    expect((await media.listWorks({ workspaceId: 'w-1' })).some(row => row.kind === 'video')).toBe(true)

    const refJobs = jobsCapture()
    const refBench = await bench({
      jobs: refJobs.service,
      internals: {
        transport: transportFor('video'),
        flush: async () => undefined,
      },
    })
    const still = await refBench.media.importBytes({
      filename: 'ref.webp',
      bytes: new Uint8Array([7, 8, 9]),
    }, 's-1', undefined)
    await refBench.media.createVideo(owner(), {
      prompt: 'The cup stays.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: [still.artifactId],
    }, { promptHash: 'p-ref', estimatedYuan: 2.5 })
    await expect(refJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
  })

  it('refuses paid video when stills change after approval', async () => {
    const videoJobs = jobsCapture()
    let stillPath = ''
    const { media } = await bench({
      jobs: videoJobs.service,
      internals: {
        transport: transportFor('video'),
        flush: async () => {
          if (stillPath !== '') await writeFile(stillPath, new Uint8Array([9, 9, 9]))
        },
      },
    })
    const still = await media.importBytes({
      filename: 'ref.webp',
      bytes: new Uint8Array([7, 8, 9]),
    }, 's-1', undefined)
    stillPath = artifactFilePath(still.artifactId, still.file)
    await media.createVideo(owner(), {
      prompt: 'The cup stays.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
      imageIds: [still.artifactId],
    }, { promptHash: 'p-changed', estimatedYuan: 2.5 })
    await expect(videoJobs.hooks()!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('image bytes changed'),
    })
  })

  it('flushes through sessions when internals.flush is omitted', async () => {
    const speechJobs = jobsCapture()
    const flushed: unknown[] = []
    const withFlush = await bench({
      jobs: speechJobs.service,
      internals: { transport: transportFor('speech') },
    })
    withFlush.ctx.provide('sessions', {
      flush: async (session: unknown) => { flushed.push(session) },
    })
    await upsertVoice({
      voiceId: MediaVoiceId('male-qn-qingse'),
      label: '青涩男声',
      system: true,
    }, { DSH_HOME: withFlush.root })
    await withFlush.media.createSpeech(owner(), '你好', 'male-qn-qingse', {
      promptHash: 'p-flush',
      estimatedYuan: 0.01,
    })
    await expect(speechJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
    expect(flushed.length).toBeGreaterThan(0)

    const skipJobs = jobsCapture()
    const skip = await bench({
      jobs: skipJobs.service,
      internals: { transport: transportFor('speech') },
    })
    skip.ctx.provide('sessions', {})
    await upsertVoice({
      voiceId: MediaVoiceId('male-qn-qingse'),
      label: '青涩男声',
      system: true,
    }, { DSH_HOME: skip.root })
    await skip.media.createSpeech(owner(), '你好', 'male-qn-qingse', {
      promptHash: 'p-skip',
      estimatedYuan: 0.01,
    })
    await expect(skipJobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })
  })

  it('records media/stop when a running video job is killed', async () => {
    const killed = jobsCapture()
    const hang = createMinimaxTransport({
      apiKey: 'k',
      baseUrl: 'https://api.example.test/',
      now: () => 0,
      sleep: async (_ms, signal) => {
        if (signal.aborted) throw new Error('aborted')
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
      },
      fetch: (async (input, init) => {
        const url = String(input)
        if (url.includes('/v2/video_generation') && !url.includes('/query/')) {
          return jsonResponse({ task_id: 'task-1' })
        }
        const signal = init?.signal
        if (signal?.aborted) throw new Error('aborted')
        await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
        return jsonResponse({})
      }) as typeof fetch,
    })
    const events: string[] = []
    const stopOwner = {
      session: {
        id: 's-1',
        append(type: string) { events.push(type) },
      },
    } as unknown as Agent
    const stopBench = await bench({
      jobs: killed.service,
      internals: {
        transport: hang,
        flush: async () => undefined,
      },
    })
    await stopBench.media.createVideo(stopOwner, {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p-stop', estimatedYuan: 2.5 })
    await Promise.resolve()
    killed.hooks()!.cancel('stop')
    await expect(killed.hooks()!.done).resolves.toMatchObject({ status: 'killed' })
    expect(events).toContain('media/stop')
  })

  it('clones from a registered sample after consent', async () => {
    const { media, env } = await bench({
      internals: {
        transport: transportFor('clone'),
        flush: async () => undefined,
      },
    })
    const imported = await media.importBytes({
      filename: 'sample.mp3',
      bytes: new Uint8Array([1, 2, 3]),
    }, 's-1', undefined)
    await expect(media.cloneVoiceFromArtifact(owner(), imported.artifactId, 'mine', {
      speakerIsUser: true,
      authorized: false,
    })).rejects.toMatchObject({ code: 'consent-missing' })
    await expect(media.cloneVoiceFromArtifact(owner(), 'missing', 'mine', {
      speakerIsUser: true,
      authorized: true,
    })).rejects.toMatchObject({ code: 'artifact-missing' })
    await expect(media.cloneVoiceFromArtifact(owner('s-other'), imported.artifactId, 'mine', {
      speakerIsUser: true,
      authorized: true,
    })).rejects.toMatchObject({ code: 'session-mismatch' })
    await expect(media.cloneVoiceFromArtifact(owner(), imported.artifactId, 'mine', {
      speakerIsUser: true,
      authorized: true,
    })).resolves.toMatchObject({ voiceId: expect.stringMatching(/^dshVoice/) })
    expect((await media.listVoices()).some(row => row.label === 'mine')).toBe(true)
    expect(env.DSH_HOME).toBeDefined()
  })

  it('composes registered clips and optional narration', async () => {
    const { media, env } = await bench({
      internals: {
        runtimeReady: async () => ({ ready: true, homeDisplay: '$DSH_HOME/media', guidance: '' }),
        flush: async () => undefined,
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      },
      config: { mediaRuntimePath: '/opt/media-runtime' },
    })
    const clip = await media.importBytes({
      filename: 'clip.mp4',
      bytes: new Uint8Array([1, 2, 3]),
    }, 's-1', undefined)
    const narr = await media.importBytes({
      filename: 'narr.mp3',
      bytes: new Uint8Array([4, 5, 6]),
    }, 's-1', undefined)
    await expect(media.compose(owner(), [], undefined, false))
      .rejects.toMatchObject({ code: 'clips-empty' })
    await expect(media.compose(owner(), ['a', 'b', 'c', 'd', 'e'], undefined, false))
      .rejects.toMatchObject({ code: 'clips-empty' })
    await expect(media.compose(owner(), ['missing'], undefined, false))
      .rejects.toMatchObject({ code: 'artifact-missing' })
    await expect(media.compose(owner(), [clip.artifactId], 'missing', false))
      .rejects.toMatchObject({ code: 'artifact-missing' })
    const composed = await media.compose(owner(), [clip.artifactId], narr.artifactId, true)
    expect(composed.kind).toBe('composed')
    const again = await media.compose(owner(), [clip.artifactId], undefined, false)
    expect(again.file).toBe('result.mp4')
    expect(env.DSH_HOME).toBeDefined()

    const unready = await bench({
      internals: {
        runtimeReady: async () => ({
          ready: false,
          homeDisplay: '$DSH_HOME/media',
          guidance: 'install',
        }),
      },
    })
    await expect(unready.media.compose(owner(), ['a'], undefined, false))
      .rejects.toMatchObject({ code: 'runtime-unready' })

    const noHome = await bench({
      internals: {
        runtimeReady: async () => ({ ready: true, homeDisplay: '$DSH_HOME/media', guidance: '' }),
      },
    })
    await expect(noHome.media.compose(owner(), ['a'], undefined, false))
      .rejects.toMatchObject({ code: 'runtime-missing' })
  })

  it('recovers known video tasks and ignores missing jobs', async () => {
    const empty = await bench()
    expect(empty.media.recover(owner())).toEqual([])

    const jobs = jobsCapture()
    const { media } = await bench({
      jobs: jobs.service,
      projections: {
        stateOf: () => ({
          requests: {
            a: {
              requestId: MediaRequestId('r_a'),
              kind: 'video',
              stage: 'running',
              label: 'keep',
              inputHashes: [],
              estimatedYuan: 2.5,
              providerTaskId: 'task-1',
            },
            b: {
              requestId: MediaRequestId('r_b'),
              kind: 'speech',
              stage: 'stopped',
              label: 'skip',
              inputHashes: [],
              estimatedYuan: 0.01,
              providerTaskId: 't2',
            },
          },
          artifacts: {},
        }),
      },
      internals: {
        transport: transportFor('video'),
        flush: async () => undefined,
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      },
    })
    expect(media.recover(owner())).toEqual(['job-1'])
    await expect(jobs.hooks()!.done).resolves.toMatchObject({ status: 'completed' })

    const speechJobs = jobsCapture()
    const speechOnly = await bench({
      jobs: speechJobs.service,
      projections: {
        stateOf: () => ({
          requests: {
            c: {
              requestId: MediaRequestId('r_c'),
              kind: 'speech',
              stage: 'running',
              label: 'speech-keep',
              inputHashes: [],
              estimatedYuan: 0.01,
              providerTaskId: 't3',
            },
          },
          artifacts: {},
        }),
      },
    })
    expect(speechOnly.media.recover(owner())).toEqual(['job-1'])
    await expect(speechJobs.hooks()!.done).resolves.toEqual({
      status: 'completed',
      output: 'nothing to recover',
    })

    const recoverKill = jobsCapture()
    const recoverEvents: string[] = []
    const recoverOwner = {
      session: {
        id: 's-1',
        append(type: string) { recoverEvents.push(type) },
      },
    } as unknown as Agent
    const hanging = await bench({
      jobs: recoverKill.service,
      projections: {
        stateOf: () => ({
          requests: {
            v: {
              requestId: MediaRequestId('r_v'),
              kind: 'video',
              stage: 'running',
              label: 'hang',
              inputHashes: [],
              estimatedYuan: 2.5,
              providerTaskId: 't-hang',
            },
          },
          artifacts: {},
        }),
      },
      internals: {
        transport: createMinimaxTransport({
          apiKey: 'k',
          baseUrl: 'https://api.example.test/',
          now: () => 0,
          sleep: async (_ms, signal) => {
            if (signal.aborted) throw new Error('aborted')
            await new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => { reject(new Error('aborted')) })
            })
          },
          fetch: (async (_input, init) => {
            const signal = init?.signal
            if (signal?.aborted) throw new Error('aborted')
            await new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
            })
            return jsonResponse({})
          }) as typeof fetch,
        }),
        flush: async () => undefined,
      },
    })
    expect(hanging.media.recover(recoverOwner)).toEqual(['job-1'])
    await Promise.resolve()
    recoverKill.hooks()!.cancel('stop')
    await expect(recoverKill.hooks()!.done).resolves.toMatchObject({ status: 'killed' })
    expect(recoverEvents).toContain('media/stop')
  })

  it('fails paid work without jobs or credentials and maps start errors', async () => {
    const none = await bench()
    await expect(none.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })).rejects.toMatchObject({ code: 'task-failed' })

    const missing = await bench({
      jobs: {
        start() { throw new Error('no job controller attached') },
      },
    })
    await expect(missing.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })).rejects.toMatchObject({ code: 'task-failed' })

    const other = await bench({
      jobs: {
        start() { throw new Error('boom') },
      },
    })
    await expect(other.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })).rejects.toThrow('boom')

    const jobs = jobsCapture()
    const creds = await bench({
      jobs: jobs.service,
      internals: { flush: async () => undefined },
    })
    await creds.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })
    await expect(jobs.hooks()!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('MINIMAX_API_KEY'),
    })

    const ctxJobs = jobsCapture()
    const viaCtx = await bench({
      jobs: ctxJobs.service,
      credentials: {
        resolve: async () => ({ value: 'k', source: 'memory' }),
      },
      internals: { flush: async () => undefined },
    })
    await viaCtx.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })
    await expect(ctxJobs.hooks()!.done).resolves.toMatchObject({ status: 'failed' })

    const noUrlJobs = jobsCapture()
    const noUrl = await bench({
      jobs: noUrlJobs.service,
      internals: {
        transport: transportFor('video-no-url'),
        flush: async () => undefined,
      },
    })
    await noUrl.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })
    await expect(noUrlJobs.hooks()!.done).resolves.toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('download URL'),
    })
  })

  it('uses session projection budget and returns spend estimates', async () => {
    const spent = await bench({
      projections: {
        stateOf: () => ({
          requests: {
            a: {
              requestId: MediaRequestId('r_a'),
              kind: 'video',
              stage: 'running',
              label: 'paid',
              inputHashes: [],
              estimatedYuan: 40,
            },
          },
          artifacts: {},
        }),
      },
    })
    await expect(spent.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })).rejects.toMatchObject({
      code: 'budget-exhausted',
    })
    let readMissing = false
    const emptyProj = await bench({
      jobs: jobsCapture().service,
      projections: {
        stateOf() {
          readMissing = true
          return undefined
        },
      },
    })
    expect(emptyProj.media.estimateYuan('video')).toBe(2.5)
    expect(emptyProj.media.estimateYuan('speech')).toBe(0.01)
    expect(emptyProj.media.estimateYuan('clone')).toBe(9.91)
    await expect(emptyProj.media.createVideo(owner(), {
      prompt: 'A green cup on a table.',
      duration: 5,
      ratio: '16:9',
      resolution: '768P',
      model: 'MiniMax-H3-Max',
    }, { promptHash: 'p1', estimatedYuan: 2.5 })).resolves.toMatchObject({
      jobId: 'job-1',
    })
    expect(readMissing).toBe(true)
    await upsertWork(work('a_keep'), { DSH_HOME: emptyProj.root })
  })
})
