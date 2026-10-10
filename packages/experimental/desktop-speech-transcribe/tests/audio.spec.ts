/** Decode-path behavior: passthrough, decoder layouts, fallback, and guidance. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateWave } from '@deepseek-ai/dsh-experimental-speech-to-text/wave'
import {
  canonicalizeDecodedWave,
  decoderArgv,
  isCanonicalSpeechWave,
  prepareSpeechAudio,
  resolveDecoder,
  type AudioCommandRunner,
  type Decoder,
} from '../src/audio.ts'
import { compressedAudio, pcmFmtBody, riffWave, wave } from './wav.ts'

vi.mock('node:fs/promises', { spy: true })

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-speech-transcribe-decode-'))
  directories.push(directory)
  return directory
}

/** Runner that records argv and writes the decoded fixture to the output path. */
function writer(output: Buffer, calls: string[][]): AudioCommandRunner {
  return {
    async run(argv) {
      calls.push([...argv])
      const target = argv[argv.length - 1]
      if (target !== undefined) await writeFile(target, output)
      return { exitCode: 0, stderr: '' }
    },
  }
}

/** Runner executing the real decoder argv through `child_process`. */
function childRunner(): AudioCommandRunner {
  return {
    async run(argv) {
      try {
        const { stderr } = await new Promise<{ stderr: string }>((resolve, reject) => {
          execFile(argv[0] as string, argv.slice(1), { encoding: 'utf8' }, (error, _stdout, stderr) => {
            if (error === null) resolve({ stderr })
            else reject(new Error(error.message))
          })
        })
        return { exitCode: 0, stderr }
      } catch (error: unknown) {
        const failure = error as { code?: number | string; stderr?: string }
        return { exitCode: typeof failure.code === 'number' ? failure.code : null, stderr: failure.stderr ?? '' }
      }
    },
  }
}

const signal = new AbortController().signal

/** Real decoders decorate the container: `FLLR` padding plus an extensible `fmt `. */
const afconvertLayout = (): Buffer => riffWave([
  { id: 'fmt ', body: pcmFmtBody(true) },
  { id: 'FLLR', body: Buffer.alloc(4044) },
  { id: 'data', body: Buffer.alloc(8_000) },
])

/** `ffmpeg -c:a pcm_s16le` writes a `LIST`/`INFO` chunk between `fmt ` and `data`. */
const ffmpegLayout = (): Buffer => riffWave([
  { id: 'fmt ', body: pcmFmtBody(false) },
  { id: 'LIST', body: Buffer.concat([Buffer.from('INFO'), Buffer.alloc(22)]) },
  { id: 'data', body: Buffer.alloc(8_000) },
])

describe('isCanonicalSpeechWave', () => {
  it('accepts only the canonical 16 kHz mono PCM16 layout', () => {
    const canonical = wave(0.1)
    expect(isCanonicalSpeechWave(canonical, canonical.byteLength)).toBe(true)
    const stereo = wave(0.1, { channels: 2 })
    expect(isCanonicalSpeechWave(stereo, stereo.byteLength)).toBe(false)
    const wide = wave(0.1, { sampleRate: 44_100 })
    expect(isCanonicalSpeechWave(wide, wide.byteLength)).toBe(false)
    expect(isCanonicalSpeechWave(Buffer.from('RIFF'), 4)).toBe(false)
    const truncated = canonical.subarray(0, 44)
    expect(isCanonicalSpeechWave(truncated, canonical.byteLength - 1)).toBe(false)
  })
})

describe('canonicalizeDecodedWave', () => {
  it('rebuilds decoder layouts into the byte-exact canonical WAV', () => {
    const expected = wave(0.25)
    expect(canonicalizeDecodedWave(afconvertLayout())).toEqual(expected)
    expect(canonicalizeDecodedWave(ffmpegLayout())).toEqual(expected)
    expect(canonicalizeDecodedWave(expected)).toEqual(expected)
  })

  it('drops the incomplete final PCM16 sample of an odd data chunk', () => {
    const odd = riffWave([
      { id: 'fmt ', body: pcmFmtBody(false) },
      { id: 'data', body: Buffer.alloc(101) },
    ])
    const canonical = canonicalizeDecodedWave(odd)
    expect(canonical).toEqual(wave(100 / 32_000))
    expect(canonical?.byteLength).toBe(144)
  })

  it.each([
    ['a non-RIFF container', compressedAudio()],
    ['a window too short for any header', Buffer.alloc(4)],
    ['a container without a data chunk', riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }])],
    ['a trailing stub after the last chunk', Buffer.concat([riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }]), Buffer.alloc(4)])],
    ['a fmt chunk shorter than 16 bytes', riffWave([{ id: 'fmt ', body: pcmFmtBody(false).subarray(0, 8) }, { id: 'data', body: Buffer.alloc(64) }])],
    ['a missing fmt chunk', riffWave([{ id: 'data', body: Buffer.alloc(64) }])],
    ['data before fmt', riffWave([{ id: 'data', body: Buffer.alloc(64) }, { id: 'fmt ', body: pcmFmtBody(false) }])],
    ['a wrong sample rate', riffWave([{ id: 'fmt ', body: pcmFmtBody(false, { sampleRate: 44_100 }) }, { id: 'data', body: Buffer.alloc(64) }])],
    ['stereo channels', riffWave([{ id: 'fmt ', body: pcmFmtBody(false, { channels: 2 }) }, { id: 'data', body: Buffer.alloc(64) }])],
    ['a non-PCM extensible sub-format', riffWave([
      { id: 'fmt ', body: (() => { const body = pcmFmtBody(true); body.writeUInt32LE(3, 24); return body })() },
      { id: 'data', body: Buffer.alloc(64) },
    ])],
    ['an empty data chunk', riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }, { id: 'data', body: Buffer.alloc(0) }])],
    ['a data chunk holding one sample byte', riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }, { id: 'data', body: Buffer.alloc(1) }])],
    ['a data chunk beyond the file end', riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }, { id: 'data', body: Buffer.alloc(64) }]).subarray(0, 60)],
    ['a header larger than the extensible bounds', riffWave([{ id: 'fmt ', body: pcmFmtBody(true).subarray(0, 20) }, { id: 'data', body: Buffer.alloc(64) }])],
  ])('rejects %s', (_label, bytes) => {
    expect(canonicalizeDecodedWave(bytes)).toBeUndefined()
  })
})

describe('resolveDecoder', () => {
  it('prefers afconvert on darwin and ffmpeg elsewhere', async () => {
    const darwin = vi.fn(async (command: string) => command === '/usr/bin/afconvert' ? '/usr/bin/afconvert' : undefined)
    await expect(resolveDecoder('darwin', darwin)).resolves.toEqual({ kind: 'afconvert', executable: '/usr/bin/afconvert' })
    expect(darwin).toHaveBeenNthCalledWith(1, 'afconvert')
    expect(darwin).toHaveBeenNthCalledWith(2, '/usr/bin/afconvert')

    const linux = vi.fn(async (command: string) => command === '/opt/homebrew/bin/ffmpeg' ? '/opt/homebrew/bin/ffmpeg' : undefined)
    await expect(resolveDecoder('linux', linux)).resolves.toEqual({ kind: 'ffmpeg', executable: '/opt/homebrew/bin/ffmpeg' })
    expect(linux).not.toHaveBeenCalledWith('afconvert')

    await expect(resolveDecoder('darwin', async () => undefined)).resolves.toBeUndefined()
  })

  it('builds the documented argv for each decoder family', () => {
    const afconvert: Decoder = { kind: 'afconvert', executable: '/usr/bin/afconvert' }
    expect(decoderArgv(afconvert, '/in.m4a', '/out.wav')).toEqual([
      '/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/in.m4a', '/out.wav',
    ])
    const ffmpeg: Decoder = { kind: 'ffmpeg', executable: '/opt/homebrew/bin/ffmpeg' }
    expect(decoderArgv(ffmpeg, '/in.m4a', '/out.wav')).toEqual([
      '/opt/homebrew/bin/ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
      '-i', '/in.m4a', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/out.wav',
    ])
  })
})

describe('prepareSpeechAudio', () => {
  it('passes a canonical WAV through without touching the decoder', async () => {
    const directory = await scratch()
    const source = join(directory, 'interview.wav')
    const canonical = wave(1)
    await writeFile(source, canonical)
    const calls: string[][] = []
    const runner = writer(wave(1), calls)
    const resolve = vi.fn(async () => '/usr/bin/afconvert')

    const audio = await prepareSpeechAudio({
      inputPath: source, inputBytes: canonical.byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal, resolve, runner,
    })

    expect(audio).toEqual(canonical)
    expect(resolve).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it.each([
    ['a wide sample rate', wave(1, { sampleRate: 44_100 })],
    ['stereo channels', wave(1, { channels: 2 })],
    ['a compressed container', compressedAudio()],
  ])('normalises %s through afconvert', async (_label, source) => {
    const directory = await scratch()
    const inputPath = join(directory, 'input.bin')
    await writeFile(inputPath, source)
    const canonical = wave(2)
    const calls: string[][] = []
    const resolve = vi.fn(async (command: string) => command === '/usr/bin/afconvert' ? '/usr/bin/afconvert' : undefined)

    const audio = await prepareSpeechAudio({
      inputPath, inputBytes: source.byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal, resolve, runner: writer(canonical, calls),
    })

    expect(audio).toEqual(canonical)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 7)).toEqual(['/usr/bin/afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1'])
    expect(calls[0]?.at(-2)).toBe(inputPath)
  })

  it.each([
    ['an afconvert FLLR/extensible layout', afconvertLayout()],
    ['a ffmpeg LIST layout', ffmpegLayout()],
  ])('rebuilds %s the real decoder writes', async (_label, decoded) => {
    const directory = await scratch()
    const inputPath = join(directory, 'input.m4a')
    await writeFile(inputPath, compressedAudio())

    const audio = await prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: writer(decoded, []),
    })

    expect(audio).toEqual(wave(0.25))
    expect(validateWave(audio, 60)).toBeCloseTo(0.25)
  })

  it.each([
    ['a canonical fmt ', [{ id: 'fmt ', body: pcmFmtBody(false) }]],
    ['an extensible fmt ', [{ id: 'fmt ', body: pcmFmtBody(true) }]],
  ])('grows the header window when %s fields straddle the first read', async (_label, fmtChunks) => {
    const directory = await scratch()
    const inputPath = join(directory, 'window.m4a')
    await writeFile(inputPath, compressedAudio())
    const decoded = riffWave([
      { id: 'JUNK', body: Buffer.alloc(28) },
      ...fmtChunks.map(chunk => ({ id: chunk.id, body: chunk.body })),
      { id: 'data', body: Buffer.alloc(8_000) },
    ])

    const audio = await prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: writer(decoded, []),
    })

    expect(audio).toEqual(wave(0.25))
  })

  it('rejects a decoded container that is not 16 kHz mono PCM16', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'stereo.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: writer(wave(1, { sampleRate: 44_100 }), []),
    })
    await expect(promise).rejects.toThrow(/不是 16 kHz 单声道 WAV/)
  })

  it('sanitizes a non-Error spawn rejection', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'literal.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: { async run() { throw 'plain failure' } },
    })
    await expect(promise).rejects.toThrow('plain failure')
  })

  it('rejects a decoded header found only after the bounded scan window', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'padded.m4a')
    await writeFile(inputPath, compressedAudio())
    const padded = riffWave([
      { id: 'fmt ', body: pcmFmtBody(false) },
      { id: 'JUNK', body: Buffer.alloc(5 * 1024 * 1024) },
      { id: 'data', body: Buffer.alloc(64) },
    ])
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: writer(padded, []),
    })
    await expect(promise).rejects.toThrow(/不是 16 kHz 单声道 WAV/)
  })

  it('falls back to ffmpeg when afconvert is absent', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'interview.mp3')
    await writeFile(inputPath, compressedAudio())
    const canonical = wave(1)
    const calls: string[][] = []
    const resolve = vi.fn(async (command: string) => command === 'ffmpeg' ? '/opt/homebrew/bin/ffmpeg' : undefined)

    const audio = await prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal, resolve, runner: writer(canonical, calls),
    })

    expect(audio).toEqual(canonical)
    expect(calls[0]?.[0]).toBe('/opt/homebrew/bin/ffmpeg')
    expect(calls[0]).toContain('-ar')
  })

  it('fails with Chinese guidance naming the file and the missing tools', async () => {
    const directory = await scratch()
    const inputPath = join(directory, '采访.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal, resolve: async () => undefined, runner: writer(wave(1), []),
    })
    await expect(promise).rejects.toThrow(/采访\.m4a/)
    await expect(promise).rejects.toThrow(/afconvert 或 ffmpeg/)
  })

  it('reports a decoder failure with the file name and a sanitized diagnostic', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'broken.m4a')
    await writeFile(inputPath, compressedAudio())
    const runner: AudioCommandRunner = {
      async run(argv) {
        return { exitCode: 1, stderr: `Error: invalid data found ${argv[argv.length - 1] as string}\n` }
      },
    }
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'afconvert' ? 'afconvert' : undefined, runner,
    })
    await expect(promise).rejects.toThrow(/broken\.m4a/)
    await expect(promise).rejects.toThrow(/Error: invalid data found speech\.wav/)
    await expect(promise).rejects.not.toThrow(/dsh-speech-transcribe-decode-/)
  })

  it('falls back to the exit code when the decoder printed nothing', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'silent.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: { async run() { return { exitCode: 2, stderr: ' \n' } } },
    })
    await expect(promise).rejects.toThrow(/退出码 2/)
  })

  it('reports a missing decoder output as a sanitized decode failure', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'vanished.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'afconvert' ? 'afconvert' : undefined,
      // A decoder that reports success without writing its output file.
      runner: { async run() { return { exitCode: 0, stderr: '' } } },
    })
    await expect(promise).rejects.toThrow(/解码音频「vanished\.m4a」失败（afconvert）/)
    await expect(promise).rejects.not.toThrow(/dsh-speech-transcribe-decode-/)
  })

  it('sanitizes a spawn failure that names the scratch paths', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'spawn.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: {
        async run() { throw new Error(`spawn failed for ${join(directory, 'speech.wav')}`) },
      },
    })
    await expect(promise).rejects.toThrow('spawn failed for speech.wav')
    await expect(promise).rejects.not.toThrow(/dsh-speech-transcribe-decode-/)
  })

  it('rejects a decoded result that is not a canonical WAV', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'weird.m4a')
    await writeFile(inputPath, compressedAudio())
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: {
        async run(argv) {
          const target = argv[argv.length - 1]
          if (target !== undefined) await writeFile(target, Buffer.from('not a wave'))
          return { exitCode: 0, stderr: '' }
        },
      },
    })
    await expect(promise).rejects.toThrow(/不是 16 kHz 单声道 WAV/)
  })

  it('refuses an over-long canonical source before reading it', async () => {
    const directory = await scratch()
    const source = join(directory, 'long.wav')
    await writeFile(source, wave(90))
    const promise = prepareSpeechAudio({
      inputPath: source, inputBytes: 44 + 90 * 32_000, tempDir: directory,
      platform: 'darwin', maxAudioMinutes: 1, signal,
      resolve: async () => undefined, runner: writer(wave(1), []),
    })
    await expect(promise).rejects.toThrow(/时长 1:30 超过上限 1 分钟/)
    expect(vi.mocked(readFile).mock.calls.every(([path]) => path !== source)).toBe(true)
  })

  it('refuses an over-long decoded payload from its header alone', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'long.m4a')
    await writeFile(inputPath, compressedAudio())
    const outputPath = join(directory, 'speech.wav')
    const decoded = riffWave([{ id: 'fmt ', body: pcmFmtBody(false) }, { id: 'data', body: Buffer.alloc(90 * 32_000) }])
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 1, signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: writer(decoded, []),
    })
    await expect(promise).rejects.toThrow(/时长 1:30 超过上限 1 分钟/)
    expect(vi.mocked(readFile).mock.calls.every(([path]) => path !== outputPath)).toBe(true)
  })

  it('propagates cancellation even when the decoder fails first', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'cancelled.m4a')
    await writeFile(inputPath, compressedAudio())
    const controller = new AbortController()
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: compressedAudio().byteLength, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal: controller.signal,
      resolve: async command => command === 'ffmpeg' ? 'ffmpeg' : undefined,
      runner: {
        async run() {
          controller.abort(new Error('caller cancelled'))
          throw new Error('spawn failed')
        },
      },
    })
    await expect(promise).rejects.toThrow('caller cancelled')
  })

  it('names the file when a short non-WAV cannot be decoded', async () => {
    const directory = await scratch()
    const inputPath = join(directory, 'short.wav')
    await writeFile(inputPath, Buffer.from('tiny'))
    const promise = prepareSpeechAudio({
      inputPath, inputBytes: 4, tempDir: directory,
      platform: 'linux', maxAudioMinutes: 120, signal, resolve: async () => undefined, runner: writer(wave(1), []),
    })
    await expect(promise).rejects.toThrow(/short\.wav/)
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/afconvert'))(
    'normalises real afconvert output end to end',
    async () => {
      const directory = await scratch()
      const source = join(directory, 'smoke.wav')
      const compressed = join(directory, 'smoke.m4a')
      await writeFile(source, wave(0.5))
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'LEI16@16000', '-c', '1', source, compressed], (error) => {
          if (error === null) resolve()
          else reject(new Error(error.message))
        })
      })

      const audio = await prepareSpeechAudio({
        inputPath: compressed, inputBytes: (await stat(compressed)).size, tempDir: directory,
        platform: 'darwin', maxAudioMinutes: 120, signal,
        resolve: async command => command === '/usr/bin/afconvert' ? '/usr/bin/afconvert' : undefined,
        runner: childRunner(),
      })

      expect(audio).toEqual(wave(0.5))
      expect(validateWave(audio, 60)).toBeCloseTo(0.5)
    },
  )
})
