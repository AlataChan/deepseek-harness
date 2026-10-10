/** speech_transcribe behavior on the real speech registry with stub seams. */
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {
  SpeechPreparation,
  SpeechPreparationState,
  SpeechProvider,
  SpeechProviderId,
  SpeechSnapshot,
  Transcript,
} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import {
  executableResolver,
  MAX_SOURCE_BYTES,
  readinessOf,
  registerSpeechTranscribeTool,
  subprocessRunner,
} from '../src/tool.ts'
import { compressedAudio, wave } from './wav.ts'

vi.mock('node:fs/promises', { spy: true })

const RESULT: Transcript = { text: '这是测试转写内容。', audioSeconds: 90, inferenceSeconds: 3.5 }
const signal = new AbortController().signal

/** The canonical value shape the tool declares. */
interface ResultValue {
  transcriptPath?: string
  characters?: number
  preview: string
  note?: string
}

const directories: string[] = []
const closers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.clearAllMocks()
})

/** Minimal execution context: the tool reads only the session cwd and the signal. */
function execution(cwd: string | undefined, callSignal: AbortSignal = signal) {
  return {
    agent: cwd === undefined ? undefined : { session: { header: { cwd } } },
    signal: callSignal,
  } as never
}

function reader(text: string) {
  return { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) }
}

/** Subprocess seam stub: lookup always succeeds and spawn writes through `decode`. */
function fakeSubprocess(options: {
  decode?: ((argv: readonly string[]) => Promise<void> | void) | undefined
  stderr?: string | undefined
  exitCode?: number | undefined
}) {
  return {
    async resolveExecutable(command: string) { return `/fake/${command}` },
    spawn(spec: { argv: readonly string[] }) {
      const done = (async () => {
        await options.decode?.(spec.argv)
        return { exitCode: options.exitCode ?? 0, signal: null }
      })()
      return {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: { stderr: reader(options.stderr ?? '') },
        done,
        terminate() {},
        waitForExit: async () => true,
      } as never
    },
  } as never
}

function stubProvider(overrides: Partial<SpeechProvider> = {}): SpeechProvider {
  return {
    info: {
      id: 'stub-local' as SpeechProviderId,
      name: 'Stub Recognizer',
      location: 'host-local',
      languages: ['auto', 'zh'],
    },
    transcribe: async () => RESULT,
    ...overrides,
  }
}

function prepared(state: SpeechPreparationState): {
  preparation: SpeechPreparation
  prepare: ReturnType<typeof vi.fn<SpeechPreparation['prepare']>>
} {
  const prepare = vi.fn<SpeechPreparation['prepare']>()
  return {
    preparation: { snapshot: () => state, subscribe: () => () => {}, prepare, cancel: async () => {} },
    prepare,
  }
}

/** Boot tools + speech + subprocess and the plugin; returns the registered tool. */
async function composition(options: {
  provider?: SpeechProvider
  defaultProvider?: string
  maxAudioMinutes?: number
  decode?: (argv: readonly string[]) => Promise<void> | void
  stderr?: string
  exitCode?: number
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-speech-transcribe-tool-'))
  directories.push(directory)
  const ctx = new Context()
  const registered: ToolDefinition[] = []
  ctx.provide('tools', {
    register(definition: ToolDefinition) {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  })
  ctx.provide('subprocess', fakeSubprocess({
    decode: options.decode, stderr: options.stderr, exitCode: options.exitCode,
  }))
  const base = ctx.plugin(SpeechToText, { defaultProvider: options.defaultProvider ?? 'stub-local', language: 'auto' })
  await base
  const service = ctx.get('speechToText')
  if (service === undefined) throw new Error('speechToText was not provided')
  const remove = options.provider === undefined ? undefined : service.register(options.provider)
  const fiber = await ctx.plugin(plugin.default, {
    maxAudioMinutes: options.maxAudioMinutes ?? 120,
    maxUploadMiB: 64,
  })
  closers.push(async () => {
    await fiber.dispose()
    if (remove !== undefined) await remove()
    await base.dispose()
  })
  const definition = registered[0]
  if (definition === undefined) throw new Error('speech_transcribe was not registered')
  return { ctx, directory, registered, definition, service, fiber }
}

/** Temp directory the last tool call created, from the spied `mkdtemp`. */
async function lastTempDir(): Promise<string> {
  const results = vi.mocked(fsp.mkdtemp).mock.results
  const prefix = join(tmpdir(), 'dsh-speech-transcribe-run-')
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index]
    if (result?.type !== 'return') continue
    const value: unknown = await result.value
    if (typeof value === 'string' && value.startsWith(prefix)) return value
  }
  throw new Error('no transcription temp directory was created')
}

/** Assert the tool removed its scratch directory after settlement. */
async function expectTempDirCleaned(): Promise<void> {
  const directory = await lastTempDir()
  await expect(fsp.stat(directory)).rejects.toThrow()
}

describe('plugin registration', () => {
  it('names the tool, waits for its seams, and disposes cleanly', async () => {
    const compositionResult = await composition()
    expect(plugin.name).toBe('desktop-speech-transcribe')
    expect(plugin.inject).toEqual(['tools', 'speechToText', 'subprocess'])
    expect(plugin.Config).toBeDefined()
    expect(compositionResult.registered.map(row => row.name)).toEqual(['speech_transcribe'])
    expect(compositionResult.definition.description).toContain('Markdown transcript')
    expect(compositionResult.ctx.get('transcriptAudio')).toBeInstanceOf(plugin.TranscriptAudio)
    await compositionResult.fiber.dispose()
    expect(compositionResult.registered).toEqual([])
    expect(compositionResult.ctx.get('transcriptAudio')).toBeUndefined()
  })

  it('renders and presents the success, note, and guidance values', async () => {
    const { definition } = await composition()
    expect(definition.output.render({}, { transcriptPath: '/a.md', characters: 3, preview: 'abc' }))
      .toEqual([{ type: 'text', text: '转写完成，共 3 字。文件已写入：/a.md\n\nabc' }])
    expect(definition.output.render({}, { transcriptPath: '/a.md', characters: 0, preview: '' }))
      .toEqual([{ type: 'text', text: '转写完成，但未识别到语音。文件已写入：/a.md' }])
    expect(definition.output.render({}, { transcriptPath: '/a.md', preview: '' }))
      .toEqual([{ type: 'text', text: '转写完成，但未识别到语音。文件已写入：/a.md' }])
    expect(definition.output.render({}, {
      transcriptPath: '/a.md', characters: 3, preview: 'abc', note: '同名文字稿已存在，本次写入「/a.2.md」。',
    })).toEqual([{ type: 'text', text: '同名文字稿已存在，本次写入「/a.2.md」。\n转写完成，共 3 字。文件已写入：/a.md\n\nabc' }])
    expect(definition.output.render({}, { preview: '请先准备模型' }))
      .toEqual([{ type: 'text', text: '请先准备模型' }])
    expect(definition.output.presentationMeta!({}, { transcriptPath: '/a.md', characters: 3 }))
      .toEqual({ kind: 'transcript', transcriptPath: '/a.md', characters: 3 })
    expect(definition.output.presentationMeta!({}, { transcriptPath: '/a.md' }))
      .toEqual({ kind: 'transcript', transcriptPath: '/a.md', characters: 0 })
    expect(definition.output.presentationMeta!({}, { preview: '请先准备模型' }))
      .toEqual({ kind: 'transcript', characters: 0 })
  })

  it('no-ops without a tools service', () => {
    const dispose = registerSpeechTranscribeTool(new Context(), { maxAudioMinutes: 120 })
    expect(dispose).toBeTypeOf('function')
    dispose()
  })
})

describe('speech_transcribe execution', () => {
  it('decodes, transcribes, and writes the transcript beside a relative recording', async () => {
    const canonical = wave(90)
    const { directory, definition } = await composition({
      provider: stubProvider(),
      decode: async (argv) => {
        const output = argv[argv.length - 1]
        if (output !== undefined) await writeFile(output, canonical)
      },
    })
    await writeFile(join(directory, '访谈.m4a'), compressedAudio())

    const value = (await definition.execute({ audioPath: '访谈.m4a', language: 'zh' }, execution(directory))) as ResultValue

    const transcriptPath = join(directory, '访谈.transcript.md')
    expect(value.transcriptPath).toBe(transcriptPath)
    expect(value.characters).toBe('这是测试转写内容。'.length)
    expect(value.preview).toBe('这是测试转写内容。')
    expect(value.note).toBeUndefined()
    const content = await readFile(transcriptPath, 'utf8')
    expect(content).toContain('# 访谈.m4a 录音转写')
    expect(content).toContain('- 时长：1:30')
    expect(content).toContain('- 转写用时：3.5 秒')
    expect(content).toContain('- 识别服务：stub-local（Stub Recognizer）')
    expect(content).toContain('这是测试转写内容。')
    await expectTempDirCleaned()
  })

  it('accepts an absolute path and an explicit provider and language', async () => {
    const { directory, definition, service } = await composition()
    await writeFile(join(directory, 'absolute.wav'), wave(1))
    const transcribe = vi.fn(async () => RESULT)
    const remove = service.register(stubProvider({
      info: { id: 'second' as SpeechProviderId, name: 'Second', location: 'host-local', languages: ['auto', 'en'] },
      transcribe,
    }))
    try {
      const value = (await definition.execute({
        audioPath: join(directory, 'absolute.wav'),
        providerId: 'second',
        language: 'en',
      }, execution(undefined))) as ResultValue
      expect(value.transcriptPath).toBe(join(directory, 'absolute.transcript.md'))
      expect(transcribe).toHaveBeenCalledOnce()
    } finally {
      await remove()
    }
  })

  it('bounds the preview and reports the full character count', async () => {
    const longText = '甲'.repeat(1_300)
    const { directory, definition } = await composition({
      provider: stubProvider({
        transcribe: async () => ({ text: longText, audioSeconds: 1, inferenceSeconds: 0.2 }),
      }),
    })
    await writeFile(join(directory, 'long.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'long.wav') }, execution(directory))) as ResultValue
    expect(value.characters).toBe(1_300)
    expect(value.preview).toHaveLength(1_200)
  })

  it('writes a transcript marked 未识别到语音 for a whitespace-only result', async () => {
    const transcribe = vi.fn(async () => ({ text: '  \n ', audioSeconds: 1, inferenceSeconds: 0.1 }))
    const { directory, definition } = await composition({ provider: stubProvider({ transcribe }) })
    await writeFile(join(directory, 'silent.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'silent.wav') }, execution(directory))) as ResultValue
    expect(value.characters).toBe(0)
    expect(value.preview).toBe('')
    expect(await readFile(value.transcriptPath ?? '', 'utf8')).toContain('未识别到语音。')
  })

  it('never replaces a transcript and suffixes each collision', async () => {
    const { directory, definition } = await composition({ provider: stubProvider() })
    const audioPath = join(directory, 'meeting.wav')
    await writeFile(audioPath, wave(1))

    const first = (await definition.execute({ audioPath }, execution(directory))) as ResultValue
    expect(first.transcriptPath).toBe(join(directory, 'meeting.transcript.md'))
    expect(first.note).toBeUndefined()
    await writeFile(first.transcriptPath as string, 'edited by hand\n')

    const second = (await definition.execute({ audioPath }, execution(directory))) as ResultValue
    expect(second.transcriptPath).toBe(join(directory, 'meeting.transcript.2.md'))
    expect(second.note).toContain('meeting.transcript.2.md')
    await expect(readFile(first.transcriptPath as string, 'utf8')).resolves.toBe('edited by hand\n')
    await expect(readFile(second.transcriptPath as string, 'utf8')).resolves.toContain('这是测试转写内容。')
  })

  it('fails when every numbered transcript name is taken', async () => {
    const { directory, definition } = await composition({ provider: stubProvider() })
    const audioPath = join(directory, 'meeting.wav')
    await writeFile(audioPath, wave(1))
    for (let index = 1; index <= 100; index += 1) {
      const name = index === 1 ? 'meeting.transcript.md' : `meeting.transcript.${String(index)}.md`
      await writeFile(join(directory, name), 'taken\n')
    }
    await expect(definition.execute({ audioPath }, execution(directory)))
      .rejects.toThrow(/同名文件过多/)
    await expectTempDirCleaned()
  })

  it('wraps a transcript write failure with the recording name only', async () => {
    const { directory, definition } = await composition({ provider: stubProvider() })
    const audioPath = join(directory, 'meeting.wav')
    await writeFile(audioPath, wave(1))
    vi.mocked(fsp.writeFile).mockRejectedValueOnce(Object.assign(new Error('no space left'), { code: 'ENOSPC' }))
    const promise = definition.execute({ audioPath }, execution(directory))
    await expect(promise).rejects.toThrow(/无法写入「meeting\.wav」/)
    await expect(promise).rejects.not.toThrow(/meeting\.transcript/)
  })
})

describe('readiness and input failures', () => {
  it('returns Chinese guidance and never calls transcribe when the provider is unprepared', async () => {
    const { preparation, prepare } = prepared({ phase: 'unprepared' })
    const transcribe = vi.fn(async () => RESULT)
    const { directory, definition } = await composition({
      provider: stubProvider({ preparation, transcribe }),
    })
    await writeFile(join(directory, 'blocked.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'blocked.wav') }, execution(directory))) as ResultValue
    expect(value.transcriptPath).toBeUndefined()
    expect(value.preview).toContain('插件')
    expect(value.preview).toContain('语音输入')
    expect(value.preview).toContain('下载并准备')
    expect(transcribe).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    await expect(readFile(join(directory, 'blocked.transcript.md'), 'utf8')).rejects.toThrow()
  })

  it('guides without a failure message when preparation failed silently', async () => {
    const { preparation } = prepared({ phase: 'failed', message: '' })
    const { directory, definition } = await composition({ provider: stubProvider({ preparation }) })
    await writeFile(join(directory, 'silent-failure.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'silent-failure.wav') }, execution(directory))) as ResultValue
    expect(value.preview).toContain('准备失败')
    expect(value.preview).not.toContain('（')
  })

  it('names the provider and its failure when preparation failed', async () => {
    const { preparation } = prepared({ phase: 'failed', message: '下载超时' })
    const { directory, definition } = await composition({ provider: stubProvider({ preparation }) })
    await writeFile(join(directory, 'failed.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'failed.wav') }, execution(directory))) as ResultValue
    expect(value.preview).toContain('Stub Recognizer')
    expect(value.preview).toContain('下载超时')
  })

  it('returns in-flight guidance while the provider is preparing', async () => {
    const transcribe = vi.fn(async () => RESULT)
    const { preparation } = prepared({ phase: 'downloading', resource: 'model', completedBytes: 512 })
    const { directory, definition } = await composition({
      provider: stubProvider({ preparation, transcribe }),
    })
    await writeFile(join(directory, 'inflight.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'inflight.wav') }, execution(directory))) as ResultValue
    expect(value.transcriptPath).toBeUndefined()
    expect(value.preview).toContain('正在准备中，请稍候')
    expect(value.preview).not.toContain('下载并准备')
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('returns guidance when no provider is registered', async () => {
    const { directory, definition } = await composition({ defaultProvider: 'ghost' })
    await writeFile(join(directory, 'ghost.wav'), wave(1))
    const value = (await definition.execute({ audioPath: join(directory, 'ghost.wav') }, execution(directory))) as ResultValue
    expect(value.preview).toContain('未找到可用的语音识别服务')
  })

  it('refuses a relative path without a session directory', async () => {
    const { definition } = await composition()
    await expect(definition.execute({ audioPath: 'missing.m4a' }, execution(undefined)))
      .rejects.toThrow(/会话工作目录/)
  })

  it('maps missing files, directories, and oversized files to Chinese diagnostics', async () => {
    const { directory, definition } = await composition()
    await expect(definition.execute({ audioPath: join(directory, 'nope.m4a') }, execution(directory)))
      .rejects.toThrow(/无法读取音频文件/)
    await mkdir(join(directory, 'folder'))
    await expect(definition.execute({ audioPath: join(directory, 'folder') }, execution(directory)))
      .rejects.toThrow(/是目录/)
    const huge = join(directory, 'huge.m4a')
    await writeFile(huge, '')
    await truncate(huge, MAX_SOURCE_BYTES + 1)
    await expect(definition.execute({ audioPath: huge }, execution(directory)))
      .rejects.toThrow(/超过 2 GiB/)
  })

  it('refuses a recording over the configured duration limit', async () => {
    const { directory, definition } = await composition({ maxAudioMinutes: 1 })
    await writeFile(join(directory, 'long.wav'), wave(90))
    await expect(definition.execute({ audioPath: join(directory, 'long.wav') }, execution(directory)))
      .rejects.toThrow(/超过上限 1 分钟/)
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    let release!: () => void
    const entered = new Promise<void>((resolve) => { release = resolve })
    const { directory, definition } = await composition({
      provider: stubProvider({
        transcribe: async (_input, callSignal) => {
          release()
          await new Promise<void>((_resolve, reject) => {
            callSignal.addEventListener('abort', () => {
              reject(callSignal.reason instanceof Error ? callSignal.reason : new Error(String(callSignal.reason)))
            }, { once: true })
          })
          return RESULT
        },
      }),
    })
    await writeFile(join(directory, 'cancel.wav'), wave(1))
    const promise = definition.execute(
      { audioPath: join(directory, 'cancel.wav') },
      execution(directory, controller.signal),
    )
    await entered
    controller.abort(new Error('用户取消'))
    await expect(promise).rejects.toThrow('用户取消')
    await expectTempDirCleaned()
  })
})

describe('temp directory cleanup', () => {
  it('removes the scratch directory after a decode failure', async () => {
    const { directory, definition } = await composition({ provider: stubProvider(), exitCode: 1 })
    await writeFile(join(directory, 'broken.m4a'), compressedAudio())
    await expect(definition.execute({ audioPath: join(directory, 'broken.m4a') }, execution(directory)))
      .rejects.toThrow(/解码音频/)
    await expectTempDirCleaned()
  })

  it('removes the scratch directory after a transcribe failure', async () => {
    const { directory, definition } = await composition({
      provider: stubProvider({
        transcribe: async () => { throw new Error('recognizer exploded') },
      }),
    })
    await writeFile(join(directory, 'explode.wav'), wave(1))
    await expect(definition.execute({ audioPath: join(directory, 'explode.wav') }, execution(directory)))
      .rejects.toThrow('recognizer exploded')
    await expectTempDirCleaned()
  })
})

describe('seam adapters', () => {
  it('reads collected stderr and tolerates a missing reader', async () => {
    const withReader = subprocessRunner({
      spawn: () => ({
        collected: { stderr: reader('boom') },
        done: Promise.resolve({ exitCode: 3, signal: null }),
      }),
    } as never)
    await expect(withReader.run(['/bin/x'], signal)).resolves.toEqual({ exitCode: 3, stderr: 'boom' })

    const withoutReader = subprocessRunner({
      spawn: () => ({
        collected: {},
        done: Promise.resolve({ exitCode: 0, signal: null }),
      }),
    } as never)
    await expect(withoutReader.run(['/bin/x'], signal)).resolves.toEqual({ exitCode: 0, stderr: '' })
  })

  it('reports executable lookup misses and propagates aborts', async () => {
    const found = executableResolver({ async resolveExecutable() { return '/usr/bin/afconvert' } } as never, signal)
    await expect(found('afconvert')).resolves.toBe('/usr/bin/afconvert')

    const missing = executableResolver({
      async resolveExecutable() { throw new Error('not found') },
    } as never, signal)
    await expect(missing('afconvert')).resolves.toBeUndefined()

    const controller = new AbortController()
    controller.abort(new Error('查找已取消'))
    const aborted = executableResolver({
      async resolveExecutable() { throw new Error('not found') },
    } as never, controller.signal)
    await expect(aborted('afconvert')).rejects.toThrow('查找已取消')
  })

  const READINESS_CASES: Array<[string, SpeechPreparationState, string]> = [
    ['ready', { phase: 'ready' }, 'proceed'],
    ['standby', { phase: 'standby' }, 'proceed'],
    ['unprepared', { phase: 'unprepared' }, '尚未准备'],
    ['cancelled', { phase: 'cancelled' }, '尚未准备'],
    ['failed', { phase: 'failed', message: '下载超时' }, '准备失败'],
    ['downloading', { phase: 'downloading', resource: 'model', completedBytes: 1 }, '正在准备中，请稍候'],
    ['checking', { phase: 'checking', startedAt: 0 }, '正在准备中，请稍候'],
    ['loading', { phase: 'loading', startedAt: 0 }, '正在准备中，请稍候'],
    ['waking', { phase: 'waking', startedAt: 0 }, '正在准备中，请稍候'],
    ['cancelling', { phase: 'cancelling', startedAt: 0 }, '正在准备中，请稍候'],
  ]
  it.each(READINESS_CASES)('classifies the %s provider phase', (_label: string, state: SpeechPreparationState, expected: string) => {
    const snapshot: SpeechSnapshot = {
      providers: [{
        id: 'p' as SpeechProviderId,
        name: 'P',
        location: 'host-local',
        languages: ['auto'],
        preparation: state,
      }],
      selection: { providerId: 'p' as SpeechProviderId, language: 'auto' },
    }
    const decision = readinessOf(snapshot)
    if (expected === 'proceed') {
      expect(decision).toEqual({ kind: 'proceed' })
      return
    }
    expect(decision).toMatchObject({ kind: 'blocked' })
    if (decision.kind !== 'blocked') throw new Error('expected a blocked readiness decision')
    expect(decision.message).toContain(expected)
  })

  it('decides readiness from the default or explicit provider', () => {
    const snapshot: SpeechSnapshot = {
      providers: [{
        id: 'p' as SpeechProviderId,
        name: 'P',
        location: 'host-local',
        languages: ['auto'],
        preparation: { phase: 'ready' },
      }],
      selection: { providerId: 'p' as SpeechProviderId, language: 'auto' },
    }
    expect(readinessOf(snapshot)).toEqual({ kind: 'proceed' })
    expect(readinessOf(snapshot, 'p')).toEqual({ kind: 'proceed' })
    expect(readinessOf(snapshot, 'other')).toMatchObject({ kind: 'blocked' })
  })
})
