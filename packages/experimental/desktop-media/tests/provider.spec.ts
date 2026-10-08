/** MiniMax adapter: credentials, validation, poll, and redacted errors. */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MediaError } from '../src/error.ts'
import {
  cloneVoice,
  createCloneVoiceId,
  createMinimaxTransport,
  createVideoTask,
  decodeHexAudio,
  DEFAULT_MINIMAX_BASE_URL,
  downloadProviderFile,
  MINIMAX_API_KEY_REF,
  queryVideoTask,
  resolveMinimaxApiKey,
  synthesizeSpeech,
  uploadVoiceCloneFile,
  waitForVideoTask,
  type MinimaxTransport,
} from '../src/provider.ts'

const videoReq = {
  model: 'MiniMax-H3-Max',
  prompt: 'A green cup on a table.',
  resolution: '768P',
  duration: 5,
  ratio: '16:9',
  promptExpansionMode: 'disabled',
} as const

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function transport(
  fetchImpl: typeof fetch,
  extras: Partial<MinimaxTransport> = {},
): MinimaxTransport {
  return createMinimaxTransport({
    apiKey: 'test-key',
    baseUrl: 'https://api.example.test/',
    fetch: fetchImpl,
    ...(extras.now ? { now: extras.now } : {}),
    ...(extras.sleep ? { sleep: extras.sleep } : {}),
  })
}

describe('credentials and transport', () => {
  it('resolves MINIMAX_API_KEY and rejects a blank value', async () => {
    await expect(resolveMinimaxApiKey({
      resolve: async () => ({ value: '  secret-key  ', source: 'memory' }),
    })).resolves.toBe('secret-key')
    expect(MINIMAX_API_KEY_REF).toBe(credentialRef('MINIMAX_API_KEY'))
    await expect(resolveMinimaxApiKey({ resolve: async () => undefined }))
      .rejects.toMatchObject({ code: 'credential-missing' })
    expect(() => createMinimaxTransport({ apiKey: '  ' })).toThrow(MediaError)
    expect(createMinimaxTransport({ apiKey: 'k' }).baseUrl).toBe(DEFAULT_MINIMAX_BASE_URL)
    expect(() => createMinimaxTransport({ apiKey: 'k', baseUrl: 'api.minimax.cn' }))
      .toThrow(MediaError)
  })

  it('uses default fetch, clock, and abortable sleep', async () => {
    const built = createMinimaxTransport({ apiKey: 'k' })
    expect(built.fetch).toBe(fetch)
    expect(typeof built.now()).toBe('number')
    await built.sleep(0, new AbortController().signal)
    const aborted = new AbortController()
    aborted.abort()
    await expect(built.sleep(10, aborted.signal)).rejects.toBeTruthy()
    const pending = new AbortController()
    const slept = built.sleep(50, pending.signal)
    pending.abort()
    await expect(slept).rejects.toBeTruthy()
  })
})

describe('voice id and hex audio', () => {
  it('builds a legal clone id and rejects a broken generator', () => {
    const id = createCloneVoiceId(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(id.startsWith('dshVoice')).toBe(true)
    expect(id.endsWith('_')).toBe(false)
    expect(() => createCloneVoiceId(() => '!!!')).toThrow(MediaError)
    expect(createCloneVoiceId().length).toBeGreaterThan(8)
  })

  it('decodes even hex and rejects empty or odd input', () => {
    expect(decodeHexAudio('4d5033').toString('ascii')).toBe('MP3')
    expect(() => decodeHexAudio('')).toThrow(MediaError)
    expect(() => decodeHexAudio('abc')).toThrow(MediaError)
    expect(() => decodeHexAudio('zz')).toThrow(MediaError)
  })
})

describe('createVideoTask', () => {
  it('posts a text-to-video body and reads task_id', async () => {
    let url = ''
    let raw = ''
    const result = await createVideoTask(transport(async (input, init) => {
      url = String(input)
      raw = String(init?.body)
      return jsonResponse({ task_id: 'task-1' })
    }), videoReq, new AbortController().signal)
    expect(result).toBe('task-1')
    expect(url).toBe('https://api.example.test/v2/video_generation')
    expect(raw).toContain('"prompt_expansion_mode":"disabled"')
    const { promptExpansionMode: _omitted, ...withoutExpansionMode } = videoReq
    const withoutExtra = await createVideoTask(transport(async (_url, init) => {
      expect(String(init?.body)).not.toContain('prompt_expansion_mode')
      return jsonResponse({ task_id: 'task-2' })
    }), withoutExpansionMode, new AbortController().signal)
    expect(withoutExtra).toBe('task-2')
    const withImage = await createVideoTask(transport(async (_url, init) => {
      const body = String(init?.body)
      expect(body).toContain('image_url')
      expect(body).toContain('first_frame')
      expect(body).toContain('data:image/png;base64,')
      return jsonResponse({ task_id: 'task-3' })
    }), {
      ...videoReq,
      images: [{
        role: 'first_frame',
        mediaType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
      }],
    }, new AbortController().signal)
    expect(withImage).toBe('task-3')
    const referenced = await createVideoTask(transport(async (_url, init) => {
      const body = String(init?.body)
      expect(body).toContain('image_url')
      expect(body).not.toContain('first_frame')
      return jsonResponse({ task_id: 'task-4' })
    }), {
      ...videoReq,
      images: [{
        role: 'reference',
        mediaType: 'image/jpeg',
        bytes: new Uint8Array([9]),
      }],
    }, new AbortController().signal)
    expect(referenced).toBe('task-4')
    await expect(createVideoTask(transport(async () => jsonResponse({ task_id: 'x' })), {
      ...videoReq,
      images: [
        { role: 'reference', mediaType: 'image/png', bytes: new Uint8Array([1]) },
        { role: 'first_frame', mediaType: 'image/png', bytes: new Uint8Array([2]) },
      ],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'image-mode-conflict' })
    await expect(createVideoTask(transport(async () => jsonResponse({ task_id: 'x' })), {
      ...videoReq,
      images: [{ role: 'reference', mediaType: 'image/png', bytes: new Uint8Array() }],
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })

  it('rejects empty prompts, H3-Max 2K, and too-short durations', async () => {
    const t = transport(async () => jsonResponse({}))
    const signal = new AbortController().signal
    await expect(createVideoTask(t, { ...videoReq, prompt: '  ' }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(createVideoTask(t, { ...videoReq, resolution: '2K' }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(createVideoTask(t, { ...videoReq, duration: 4 }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    const { promptExpansionMode: _omitted, ...baseVideoReq } = videoReq
    await expect(createVideoTask(t, {
      ...baseVideoReq,
      model: 'MiniMax-H3',
      resolution: '768P',
      duration: 3,
    }, signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })

  it('maps HTTP, network, and invalid JSON failures', async () => {
    const signal = new AbortController().signal
    await expect(createVideoTask(transport(async () => jsonResponse({
      error: { message: 'see https://cdn.example/signed' },
    }, 401)), videoReq, signal)).rejects.toMatchObject({
      code: 'provider-http',
      message: expect.stringContaining('[redacted-url]'),
    })
    await expect(createVideoTask(transport(async () => {
      throw new Error('offline')
    }), videoReq, signal)).rejects.toMatchObject({ code: 'provider-http' })
    await expect(createVideoTask(transport(async () => new Response('not-json')), videoReq, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(createVideoTask(transport(async () => jsonResponse([])), videoReq, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(createVideoTask(transport(async () => jsonResponse({})), videoReq, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
  })
})

describe('query and wait', () => {
  it('reads usage and download URL without requiring either', async () => {
    const signal = new AbortController().signal
    await expect(queryVideoTask(transport(async () => jsonResponse({
      task: {
        id: 't1',
        model: 'MiniMax-H3-Max',
        status: 'succeeded',
        usage: { output_seconds: 5 },
        content: { url: 'https://cdn.example/out.mp4' },
      },
    })), 't1', signal)).resolves.toMatchObject({
      id: 't1',
      outputSeconds: 5,
      downloadUrl: 'https://cdn.example/out.mp4',
    })
    await expect(queryVideoTask(transport(async () => jsonResponse({
      task: { status: 'queued' },
    })), 't2', signal)).resolves.toMatchObject({ id: 't2', status: 'queued' })
  })

  it('rejects blank ids, missing tasks, and unknown statuses', async () => {
    const t = transport(async () => jsonResponse({}))
    const signal = new AbortController().signal
    await expect(queryVideoTask(t, '  ', signal)).rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(queryVideoTask(t, 't', signal)).rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(queryVideoTask(transport(async () => jsonResponse({
      task: { status: 'paused' },
    })), 't', signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })

  it('returns after running, fails on cancelled, and times out', async () => {
    const signal = new AbortController().signal
    const sleeps: number[] = []
    let n = 0
    const ok = await waitForVideoTask(transport(async () => {
      n += 1
      return jsonResponse({ task: { id: 't', status: n === 1 ? 'running' : 'succeeded' } })
    }, {
      now: () => n * 10,
      sleep: async (ms) => { sleeps.push(ms) },
    }), 't', signal, { intervalMs: 7, timeoutMs: 100 })
    expect(ok.status).toBe('succeeded')
    expect(sleeps).toEqual([7])

    await expect(waitForVideoTask(transport(async () => jsonResponse({
      task: { status: 'cancelled' },
    }), { now: () => 0, sleep: async () => undefined }), 't', signal, {
      intervalMs: 1,
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: 'task-failed' })

    await expect(waitForVideoTask(transport(async () => jsonResponse({
      task: { status: 'failed' },
    }), { now: () => 0 }), 't', signal, { intervalMs: 1, timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'task-failed' })

    let clock = 0
    await expect(waitForVideoTask(transport(async () => jsonResponse({
      task: { status: 'queued' },
    }), {
      now: () => clock,
      sleep: async () => { clock = 20 },
    }), 't', signal, {
      intervalMs: 1,
      timeoutMs: 5,
    })).rejects.toMatchObject({ code: 'task-timeout' })

    await expect(waitForVideoTask(transport(async () => jsonResponse({ task: { status: 'queued' } })),
      't', signal, { intervalMs: 0, timeoutMs: 10 }))
      .rejects.toMatchObject({ code: 'provider-invalid' })
  })
})

describe('speech, upload, and clone', () => {
  it('decodes hex speech and reports usage', async () => {
    const result = await synthesizeSpeech(transport(async () => jsonResponse({
      data: { audio: '4d5033' },
      extra_info: { usage_characters: 12, audio_length: 900 },
      base_resp: { status_code: 0 },
    })), {
      model: 'speech-2.8-hd',
      text: '你好',
      voiceId: 'male-qn-qingse',
    }, new AbortController().signal)
    expect(result.audio.toString('ascii')).toBe('MP3')
    expect(result.usageCharacters).toBe(12)
    expect(result.durationMs).toBe(900)
  })

  it('rejects empty speech, missing audio, and a failed base_resp', async () => {
    const t = transport(async () => jsonResponse({}))
    const signal = new AbortController().signal
    await expect(synthesizeSpeech(t, { model: 'speech-2.8-hd', text: '', voiceId: 'v' }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(synthesizeSpeech(transport(async () => jsonResponse({ data: {} })), {
      model: 'speech-2.8-hd',
      text: 'hi',
      voiceId: 'v',
    }, signal)).rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(synthesizeSpeech(transport(async () => jsonResponse({
      base_resp: { status_code: 1004, status_msg: 'auth https://x' },
    })), { model: 'speech-2.8-hd', text: 'hi', voiceId: 'v' }, signal))
      .rejects.toMatchObject({
        code: 'provider-http',
        message: expect.stringContaining('[redacted-url]'),
      })
    await expect(synthesizeSpeech(transport(async () => jsonResponse({
      base_resp: null,
    })), { model: 'speech-2.8-hd', text: 'hi', voiceId: 'v' }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(synthesizeSpeech(transport(async () => jsonResponse({
      data: [],
      extra_info: [],
    })), {
      model: 'speech-2.8-hd',
      text: 'hi',
      voiceId: 'v',
      format: 'flac',
    }, signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })

  it('uploads clone audio and clones without preview text', async () => {
    const signal = new AbortController().signal
    let uploadIsForm = false
    const fileId = await uploadVoiceCloneFile(transport(async (_url, init) => {
      uploadIsForm = init?.body instanceof FormData
      return jsonResponse({ file: { file_id: 99 }, base_resp: { status_code: 0 } })
    }), { filename: 'sample.mp3', bytes: new Uint8Array([1, 2, 3]) }, signal)
    expect(fileId).toBe(99)
    expect(uploadIsForm).toBe(true)

    let cloneBody = ''
    await cloneVoice(transport(async (_url, init) => {
      cloneBody = String(init?.body)
      return jsonResponse({ base_resp: { status_code: 0 } })
    }), 99, 'dshE2eVoice01', signal)
    expect(cloneBody).toContain('"file_id":99')
    expect(cloneBody).not.toContain('"text"')
  })

  it('rejects empty uploads, missing file ids, and illegal voice ids', async () => {
    const t = transport(async () => jsonResponse({}))
    const signal = new AbortController().signal
    await expect(uploadVoiceCloneFile(t, { filename: 'a.mp3', bytes: new Uint8Array() }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(uploadVoiceCloneFile(transport(async () => jsonResponse({
      file: {},
      base_resp: { status_code: 0 },
    })), { filename: 'a.mp3', bytes: new Uint8Array([1]) }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(uploadVoiceCloneFile(transport(async () => jsonResponse({
      file: [],
      base_resp: { status_code: 0 },
    })), { filename: 'a.mp3', bytes: new Uint8Array([1]) }, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(cloneVoice(t, 1, 'bad', signal)).rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(synthesizeSpeech(transport(async () => jsonResponse({
      base_resp: { status_code: 2013 },
    })), { model: 'speech-2.8-hd', text: 'hi', voiceId: 'v' }, signal))
      .rejects.toMatchObject({ code: 'provider-http' })
    await expect(createVideoTask(transport(async () => jsonResponse({ message: 'nope' }, 400)),
      videoReq, signal)).rejects.toMatchObject({ code: 'provider-http' })
    await expect(createVideoTask(transport(async () => jsonResponse({
      error: { message: '' },
    }, 400)), videoReq, signal)).rejects.toMatchObject({
      code: 'provider-http',
      message: expect.stringContaining('request failed'),
    })
    await expect(createVideoTask(transport(async () => jsonResponse({}, 400)), videoReq, signal))
      .rejects.toMatchObject({
        code: 'provider-http',
        message: expect.stringContaining('request failed'),
      })
    await expect(createVideoTask(transport(async () => new Response('', { status: 200 })),
      videoReq, signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })
})

describe('downloadProviderFile', () => {
  it('writes bytes and rejects bad URLs, relative paths, and empty bodies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-dl-'))
    const dest = join(root, 'out.mp4')
    const t = transport(async () => new Response(Buffer.from('mp4'), { status: 200 }))
    await downloadProviderFile(t, 'https://cdn.example/a.mp4', dest, new AbortController().signal)
    expect(await readFile(dest, 'utf8')).toBe('mp4')

    const signal = new AbortController().signal
    await expect(downloadProviderFile(t, 'file:///tmp/a', dest, signal))
      .rejects.toMatchObject({ code: 'provider-invalid' })
    await expect(downloadProviderFile(t, 'https://cdn.example/a.mp4', 'out.mp4', signal))
      .rejects.toMatchObject({ code: 'path-not-absolute' })
    await expect(downloadProviderFile(transport(async () => {
      throw new Error('offline')
    }), 'https://cdn.example/a.mp4', dest, signal)).rejects.toMatchObject({ code: 'provider-http' })
    await expect(downloadProviderFile(transport(async () => new Response('', { status: 404 })),
      'https://cdn.example/a.mp4', dest, signal)).rejects.toMatchObject({ code: 'provider-http' })
    await expect(downloadProviderFile(transport(async () => new Response(new Uint8Array(), { status: 200 })),
      'https://cdn.example/a.mp4', dest, signal)).rejects.toMatchObject({ code: 'provider-invalid' })
  })
})
