/**
 * Decode a local recording to the canonical 16 kHz mono PCM16 WAV the speech
 * seam forwards to providers. macOS `afconvert` is preferred; FFmpeg from
 * PATH or its Homebrew prefixes is the fallback. Real decoder output carries
 * `FLLR`/`LIST` chunks or an extensible `fmt ` chunk, so a validated decoded
 * container is rebuilt into the exact canonical 44-byte layout instead of
 * being forwarded as-is.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/audio
 */

import { open, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { formatClock } from './transcript.ts'

/** Byte length of the canonical 16 kHz mono PCM16 WAV header. */
export const CANONICAL_WAVE_HEADER_BYTES = 44

/** Bytes read from a file head before the header scan grows the window. */
export const WAVE_PREFIX_BYTES = 64

/** Upper bound of the decoded-file header scan; real decoders stay far below it. */
const MAX_HEADER_SCAN_BYTES = 4 * 1024 * 1024

/** Bytes per second of canonical 16 kHz mono PCM16 audio. */
const CANONICAL_WAVE_BYTES_PER_SECOND = 32_000

/** PCM format tag, including the sub-format tag of a WAVE_FORMAT_EXTENSIBLE header. */
const WAVE_FORMAT_PCM = 0x0001

/** Extensible container tag whose real format lives in the sub-format GUID. */
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

/**
 * Whether the file head is exactly the canonical 16 kHz mono PCM16 WAV the
 * speech seam forwards unchanged (the layout `validateWave` in
 * `@deepseek-ai/dsh-experimental-speech-to-text/wave` accepts); any other
 * container or format needs decoding.
 * @param prefix - bytes read from the file head.
 * @param totalBytes - complete file size in bytes.
 * @returns true when no decoding is required.
 */
export function isCanonicalSpeechWave(prefix: Uint8Array, totalBytes: number): boolean {
  if (totalBytes < 46 || prefix.byteLength < CANONICAL_WAVE_HEADER_BYTES) return false
  const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
  const text = (start: number, end: number): string => {
    let value = ''
    for (let index = start; index < end; index += 1) value += String.fromCharCode(prefix[index] as number)
    return value
  }
  return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE' && text(12, 16) === 'fmt '
    && view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1
    && view.getUint32(24, true) === 16_000 && view.getUint32(28, true) === CANONICAL_WAVE_BYTES_PER_SECOND
    && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16
    && text(36, 40) === 'data' && view.getUint32(4, true) === totalBytes - 8
    && view.getUint32(40, true) === totalBytes - CANONICAL_WAVE_HEADER_BYTES
    && (totalBytes - CANONICAL_WAVE_HEADER_BYTES) % 2 === 0
}

/** Format and payload facts one RIFF chunk list yields. */
interface WaveFacts {
  /** `wFormatTag` of the `fmt ` chunk. */
  readonly formatTag: number
  /** PCM sub-format tag of a WAVE_FORMAT_EXTENSIBLE header, when present. */
  readonly subFormatTag: number | undefined
  readonly channels: number
  readonly sampleRate: number
  readonly bitsPerSample: number
  /** Offset of the `data` payload in the file. */
  readonly dataOffset: number
  /** Declared `data` payload length in bytes. */
  readonly dataLength: number
}

/** One walk over a RIFF chunk list; `incomplete` means the read window ended early. */
type WaveWalk =
  | { readonly status: 'ok'; readonly facts: WaveFacts }
  | { readonly status: 'invalid' }
  | { readonly status: 'incomplete' }

/**
 * Walk a RIFF chunk list without reading chunk bodies: chunk headers are
 * enough to skip `FLLR`/`LIST` decoration, and the `data` payload only needs
 * its offset and declared length.
 * @param bytes - file head bytes, at least the chunk headers walked so far.
 * @param totalBytes - complete file size, so a declared length can be checked without reading it.
 * @returns the `fmt `/`data` facts, or why no usable recording was found.
 */
function walkWaveChunks(bytes: Uint8Array, totalBytes: number): WaveWalk {
  // A window shorter than any header is incomplete, never invalid: the caller
  // grows it, and a file that ends there fails the same way at EOF.
  if (bytes.byteLength < 12) return { status: 'incomplete' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start: number, end: number): string => {
    let value = ''
    for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index] as number)
    return value
  }
  if (text(0, 4) !== 'RIFF' || text(8, 12) !== 'WAVE') return { status: 'invalid' }
  let offset = 12
  let format: Omit<WaveFacts, 'dataOffset' | 'dataLength'> | undefined
  while (offset + 8 <= totalBytes) {
    if (offset + 8 > bytes.byteLength) return { status: 'incomplete' }
    const id = text(offset, offset + 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ') {
      if (size < 16 || offset + 8 + size > totalBytes) return { status: 'invalid' }
      // One window check for both layouts: PCM needs its 16-byte body, and an
      // extensible header's sub-format GUID lives within the first 40.
      if (offset + 8 + Math.min(size, 40) > bytes.byteLength) return { status: 'incomplete' }
      const formatTag = view.getUint16(offset + 8, true)
      const channels = view.getUint16(offset + 10, true)
      const sampleRate = view.getUint32(offset + 12, true)
      const bitsPerSample = view.getUint16(offset + 22, true)
      let subFormatTag: number | undefined
      if (formatTag === WAVE_FORMAT_EXTENSIBLE) {
        if (size < 40) return { status: 'invalid' }
        subFormatTag = view.getUint32(offset + 8 + 24, true)
      }
      format = { formatTag, subFormatTag, channels, sampleRate, bitsPerSample }
    } else if (id === 'data') {
      if (format === undefined || size === 0 || offset + 8 + size > totalBytes) return { status: 'invalid' }
      return { status: 'ok', facts: { ...format, dataOffset: offset + 8, dataLength: size } }
    }
    offset += 8 + size + (size % 2)
  }
  return offset >= totalBytes ? { status: 'invalid' } : { status: 'incomplete' }
}

/** Whether the parsed format is 16 kHz mono PCM16. */
function isSpeechPcm(facts: WaveFacts): boolean {
  const pcm = facts.formatTag === WAVE_FORMAT_PCM
    || (facts.formatTag === WAVE_FORMAT_EXTENSIBLE && facts.subFormatTag === WAVE_FORMAT_PCM)
  return pcm && facts.channels === 1 && facts.sampleRate === 16_000 && facts.bitsPerSample === 16
}

/**
 * Rebuild one decoded RIFF container into the byte-exact canonical 44-byte
 * WAV layout the speech seam accepts: a 16-byte PCM `fmt ` chunk and the exact
 * `data` payload. A declared odd payload loses its incomplete final PCM16
 * sample; any other format is rejected.
 * @param bytes - decoded RIFF bytes.
 * @returns canonical WAV bytes, or undefined when the container is not 16 kHz mono PCM16.
 */
export function canonicalizeDecodedWave(bytes: Uint8Array): Uint8Array | undefined {
  const walk = walkWaveChunks(bytes, bytes.byteLength)
  if (walk.status !== 'ok' || !isSpeechPcm(walk.facts)) return undefined
  const payload = walk.facts.dataLength - (walk.facts.dataLength % 2)
  if (payload === 0) return undefined
  const canonical = Buffer.alloc(CANONICAL_WAVE_HEADER_BYTES + payload)
  canonical.write('RIFF', 0, 'ascii')
  canonical.writeUInt32LE(CANONICAL_WAVE_HEADER_BYTES - 8 + payload, 4)
  canonical.write('WAVE', 8, 'ascii')
  canonical.write('fmt ', 12, 'ascii')
  canonical.writeUInt32LE(16, 16)
  canonical.writeUInt16LE(WAVE_FORMAT_PCM, 20)
  canonical.writeUInt16LE(1, 22)
  canonical.writeUInt32LE(16_000, 24)
  canonical.writeUInt32LE(CANONICAL_WAVE_BYTES_PER_SECOND, 28)
  canonical.writeUInt16LE(2, 32)
  canonical.writeUInt16LE(16, 34)
  canonical.write('data', 36, 'ascii')
  canonical.writeUInt32LE(payload, 40)
  Buffer.from(bytes.buffer, bytes.byteOffset + walk.facts.dataOffset, payload).copy(canonical, CANONICAL_WAVE_HEADER_BYTES)
  return canonical
}

/** Audio decoder families this tool can invoke. */
export type DecoderKind = 'afconvert' | 'ffmpeg'

/** One resolved decoder executable. */
export interface Decoder {
  /** Decoder family; decides the argument list. */
  readonly kind: DecoderKind
  /** Canonical executable path returned by the subprocess seam. */
  readonly executable: string
}

/** One finished decoder invocation. */
export interface AudioCommandOutcome {
  /** Child exit code, or null when it died from a signal. */
  readonly exitCode: number | null
  /** Collected stderr, used only for failure diagnostics. */
  readonly stderr: string
}

/** Runs one external command; production wraps `ctx.subprocess`, tests inject fakes. */
export interface AudioCommandRunner {
  /**
   * @param argv - program and arguments, never shell-interpreted.
   * @param signal - caller cancellation.
   * @returns exit facts after the process and its pipes settle.
   */
  run(argv: readonly string[], signal: AbortSignal): Promise<AudioCommandOutcome>
}

/** Inputs of one decode attempt. */
export interface PrepareSpeechAudioOptions {
  /** Absolute path of the user's recording. */
  readonly inputPath: string
  /** File size from the caller's stat, so the header read stays bounded. */
  readonly inputBytes: number
  /** Caller-owned scratch directory for the decoder output. */
  readonly tempDir: string
  /** One-way executable lookup: a candidate name to its canonical path, or undefined when absent. */
  readonly resolve: (command: string) => Promise<string | undefined>
  /** External command runner. */
  readonly runner: AudioCommandRunner
  /** Host platform; darwin prefers the system `afconvert`. */
  readonly platform: NodeJS.Platform
  /** Deployment recording bound; enforced from header facts before any payload read. */
  readonly maxAudioMinutes: number
  /** Caller cancellation; an aborted call rejects even when the decoder failed first. */
  readonly signal: AbortSignal
}

/**
 * Select the decoder for one platform. `afconvert` is preferred on darwin at
 * its PATH name or fixed system path; FFmpeg is the fallback everywhere at its
 * PATH name or the two Homebrew prefixes.
 * @param platform - `process.platform` value.
 * @param resolve - executable lookup seam.
 * @returns the first available decoder, or undefined when neither exists.
 */
export async function resolveDecoder(
  platform: NodeJS.Platform,
  resolve: (command: string) => Promise<string | undefined>,
): Promise<Decoder | undefined> {
  if (platform === 'darwin') {
    for (const candidate of ['afconvert', '/usr/bin/afconvert'] as const) {
      const executable = await resolve(candidate)
      if (executable !== undefined) return { kind: 'afconvert', executable }
    }
  }
  for (const candidate of ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] as const) {
    const executable = await resolve(candidate)
    if (executable !== undefined) return { kind: 'ffmpeg', executable }
  }
  return undefined
}

/**
 * Build the decode argument list for one decoder.
 * @param decoder - selected decoder.
 * @param inputPath - absolute source recording.
 * @param outputPath - absolute WAV output the decoder writes.
 * @returns argv for the subprocess seam.
 */
export function decoderArgv(decoder: Decoder, inputPath: string, outputPath: string): string[] {
  return decoder.kind === 'afconvert'
    ? [decoder.executable, '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', inputPath, outputPath]
    : [decoder.executable, '-y', '-hide_banner', '-loglevel', 'error', '-i', inputPath,
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputPath]
}

/**
 * Produce the canonical WAV bytes for one source recording. A canonical WAV
 * passes through untouched; every other container is decoded, its header
 * validated and duration checked, and its payload rebuilt into the canonical
 * layout — all before the payload is read.
 * @param options - paths, seams, limits, and cancellation.
 * @returns canonical 16 kHz mono PCM16 WAV bytes.
 * @throws when the recording exceeds the duration bound, no decoder exists, or
 * the decode yields no 16 kHz mono PCM16 payload; the message names the recording.
 */
export async function prepareSpeechAudio(options: PrepareSpeechAudioOptions): Promise<Uint8Array> {
  const prefix = await readPrefix(options.inputPath, WAVE_PREFIX_BYTES)
  if (isCanonicalSpeechWave(prefix, options.inputBytes)) {
    assertWithinDuration(options.inputPath, canonicalWaveSecondsFromLength(options.inputBytes), options.maxAudioMinutes)
    return await readFile(options.inputPath)
  }
  const decoder = await resolveDecoder(options.platform, options.resolve)
  if (decoder === undefined) {
    throw new Error(`无法解码音频「${basename(options.inputPath)}」：本机没有 afconvert 或 ffmpeg。`
      + '请安装 FFmpeg（例如 brew install ffmpeg）后重试，或改用 16 kHz 单声道 WAV 录音。')
  }
  const outputPath = join(options.tempDir, 'speech.wav')
  const scratch = [options.tempDir, outputPath]
  const decodeFailure = (error: unknown): Error => new Error(
    `解码音频「${basename(options.inputPath)}」失败（${decoder.kind}）：`
    + sanitizeDiagnostic(errorMessage(error), scratch), { cause: error })
  const outcome = await options.runner.run(decoderArgv(decoder, options.inputPath, outputPath), options.signal)
    .catch((error: unknown) => {
      // A failed spawn while the caller already cancelled is a cancellation,
      // not a decode diagnostic.
      options.signal.throwIfAborted()
      throw new Error(sanitizeDiagnostic(errorMessage(error), scratch), { cause: error })
    })
  options.signal.throwIfAborted()
  if (outcome.exitCode !== 0) {
    const detail = lastLine(outcome.stderr) ?? `退出码 ${String(outcome.exitCode)}`
    throw new Error(`解码音频「${basename(options.inputPath)}」失败（${decoder.kind}）：`
      + sanitizeDiagnostic(detail, scratch))
  }
  let facts: WaveFacts | undefined
  try {
    facts = await inspectDecodedWave(outputPath)
  } catch (error: unknown) {
    throw decodeFailure(error)
  }
  const invalid = (): Error => new Error(
    `解码音频「${basename(options.inputPath)}」的结果不是 16 kHz 单声道 WAV（${decoder.kind}）。`)
  if (facts === undefined) throw invalid()
  assertWithinDuration(options.inputPath, facts.dataLength / CANONICAL_WAVE_BYTES_PER_SECOND, options.maxAudioMinutes)
  let decoded: Buffer
  /* v8 ignore start -- the tool owns this temp dir, so its output disappears only through an external deletion */
  try {
    decoded = await readFile(outputPath)
  } catch (error: unknown) {
    throw decodeFailure(error)
  }
  /* v8 ignore stop */
  const canonical = canonicalizeDecodedWave(decoded)
  if (canonical === undefined) throw invalid()
  return canonical
}

/** Canonical duration implied by a canonical WAV's total byte length. */
function canonicalWaveSecondsFromLength(totalBytes: number): number {
  return (totalBytes - CANONICAL_WAVE_HEADER_BYTES) / CANONICAL_WAVE_BYTES_PER_SECOND
}

/** Reject a recording over the deployment bound before its payload is read. */
function assertWithinDuration(inputPath: string, seconds: number, maxAudioMinutes: number): void {
  if (seconds <= maxAudioMinutes * 60) return
  throw new Error(`录音「${basename(inputPath)}」时长 ${formatClock(seconds)}`
    + ` 超过上限 ${String(maxAudioMinutes)} 分钟。`)
}

/**
 * Read the decoded file's header facts without reading its payload. The scan
 * window grows only when a chunk header or the `fmt ` fields are not yet in it.
 * @param path - absolute decoder output.
 * @returns parsed facts, or undefined when no usable header exists.
 */
async function inspectDecodedWave(path: string): Promise<WaveFacts | undefined> {
  const info = await stat(path)
  for (let limit = WAVE_PREFIX_BYTES; limit <= MAX_HEADER_SCAN_BYTES; limit *= 4) {
    const prefix = await readPrefix(path, Math.min(limit, info.size))
    const walk = walkWaveChunks(prefix, info.size)
    if (walk.status === 'ok') return walk.facts
    if (walk.status === 'invalid' || prefix.byteLength >= info.size) return undefined
  }
  return undefined
}

/** Read a bounded file head. */
async function readPrefix(path: string, limit: number): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Replace internal scratch paths in a diagnostic with their base names, longest first. */
function sanitizeDiagnostic(text: string, paths: readonly string[]): string {
  let result = text
  for (const path of [...paths].sort((left, right) => right.length - left.length)) {
    result = result.split(path).join(basename(path))
  }
  return result
}

/** Last non-empty stderr line, which decoders put their diagnostic on. */
function lastLine(text: string): string | undefined {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  return lines.at(-1)
}

/** Message text of an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
