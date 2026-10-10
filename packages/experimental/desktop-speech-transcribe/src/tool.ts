/**
 * The model-visible `speech_transcribe` tool: decode one local recording to
 * the canonical WAV the speech seam accepts, recognize it through
 * `ctx.speechToText`, and write `<name>.transcript.md` beside the audio
 * without replacing an existing transcript.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/tool
 */

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SpeechProviderId, SpeechSnapshot } from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { prepareSpeechAudio, type AudioCommandRunner } from './audio.ts'
import { isErrnoCode } from './staging.ts'
import { renderTranscript } from './transcript.ts'

/** Largest source recording refused before any read, in bytes. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024

/** Characters of the transcript returned to the model. */
const PREVIEW_CHARS = 1200

/** Termination grace period for the decoder, in milliseconds. */
const DECODER_GRACE_MS = 2_000

/** Retained decoder diagnostic bytes per stream. */
const DECODER_LOG_BYTES = 64 * 1024

/** Transcript name collisions tolerated before the write fails. */
const MAX_TRANSCRIPT_ATTEMPTS = 100

/** Runtime validation shape for the transcription tool. */
export interface SpeechTranscribeConfig {
  /** Maximum accepted recording duration in minutes. */
  readonly maxAudioMinutes: number
}

/** Whether the selected recognizer can transcribe now. */
export type ReadinessDecision =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'blocked'; readonly message: string }

/**
 * Read the selected provider's preparation state before submitting audio.
 * An unprepared, cancelled, or failed provider blocks with Chinese guidance;
 * an in-flight preparation asks the caller to retry later; a missing provider
 * blocks with the same guidance instead of the seam's English rejection.
 * @param snapshot - one consistent provider roster and selection.
 * @param providerId - explicit provider choice, or the persisted default.
 * @returns proceed, or the Chinese guidance text to return to the user.
 */
export function readinessOf(snapshot: SpeechSnapshot, providerId?: string): ReadinessDecision {
  const selected = providerId ?? snapshot.selection.providerId
  const view = snapshot.providers.find(provider => provider.id === selected)
  if (view === undefined) {
    return { kind: 'blocked', message: '未找到可用的语音识别服务。请打开「插件」→「语音输入」，'
      + '启用语音输入并选择识别服务，完成「下载并准备」后再试。' }
  }
  const phase = view.preparation.phase
  if (phase === 'unprepared' || phase === 'cancelled') {
    return { kind: 'blocked', message: `语音识别服务「${view.name}」尚未准备。请打开「插件」→「语音输入」，`
      + '点击「下载并准备」，完成后再试。' }
  }
  if (phase === 'failed') {
    const detail = view.preparation.message.length === 0 ? '' : `（${view.preparation.message}）`
    return { kind: 'blocked', message: `语音识别服务「${view.name}」准备失败${detail}。`
      + '请打开「插件」→「语音输入」重试「下载并准备」。' }
  }
  if (phase === 'downloading' || phase === 'checking' || phase === 'loading'
    || phase === 'waking' || phase === 'cancelling') {
    return { kind: 'blocked', message: `语音识别服务「${view.name}」正在准备中，请稍候。`
      + '准备完成后重试即可，无需重新下载。' }
  }
  return { kind: 'proceed' }
}

/**
 * Wrap the Host subprocess seam as the decoder's command runner.
 * @param subprocess - execution-world process provider.
 * @returns runner reading the collected stderr after settlement.
 */
export function subprocessRunner(subprocess: SubprocessRuntime): AudioCommandRunner {
  return {
    async run(argv, signal) {
      const handle = subprocess.spawn({
        argv,
        cwd: tmpdir(),
        graceMs: DECODER_GRACE_MS,
        signal,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: DECODER_LOG_BYTES },
          stderr: { maxBytes: DECODER_LOG_BYTES },
        },
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode,
        stderr: handle.collected.stderr === undefined ? '' : handle.collected.stderr.readFrom(0).text,
      }
    },
  }
}

/**
 * Adapt {@link SubprocessRuntime.resolveExecutable} to the decoder's one-way
 * lookup. A lookup miss is absence; caller cancellation still propagates.
 * @param subprocess - execution-world process provider.
 * @param signal - caller cancellation.
 * @returns lookup from candidate name to canonical path or undefined.
 */
export function executableResolver(
  subprocess: SubprocessRuntime,
  signal: AbortSignal,
): (command: string) => Promise<string | undefined> {
  return async (command) => {
    try {
      return await subprocess.resolveExecutable(command, undefined, signal)
    } catch {
      // Lookup misses report absence rather than failing the call.
      signal.throwIfAborted()
      return undefined
    }
  }
}

/**
 * Register the `speech_transcribe` tool; disposed with the plugin fiber.
 * @param ctx - Host context holding tools, the speech registry, and the subprocess seam.
 * @param config - validated plugin configuration.
 * @returns disposer removing the tool registration.
 */
export function registerSpeechTranscribeTool(ctx: Context, config: SpeechTranscribeConfig): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}

  return tools.register(defineTool({
    name: 'speech_transcribe',
    description:
      'Transcribe one local audio recording into a Markdown transcript written beside the recording. '
      + 'Use it when the user points at an interview, meeting, or activity recording and wants text or minutes. '
      + 'The recording is decoded locally and recognized by the configured speech service. '
      + 'Returns the transcript file path, its character count, and the first 1200 characters; '
      + 'an existing transcript is never replaced, and a name collision gains a numbered suffix; '
      + 'when the recognition service is not prepared, returns Chinese preparation guidance instead.',
    parameters: {
      audioPath: {
        type: 'string',
        required: true,
        description: 'Recording to transcribe: a workspace-relative or absolute file path.',
      },
      language: {
        type: 'string',
        description: 'Recognition language hint such as zh or en; omit to use the configured default.',
      },
      providerId: {
        type: 'string',
        description: 'Registered speech provider id; omit to use the configured default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          transcriptPath: { type: 'string' },
          characters: { type: 'integer' },
          preview: { type: 'string', required: true },
          note: { type: 'string' },
        },
      },
      render(_args, value) {
        if (value.transcriptPath === undefined) return [{ type: 'text', text: value.preview }]
        const characters = value.characters ?? 0
        const summary = characters === 0
          ? `转写完成，但未识别到语音。文件已写入：${value.transcriptPath}`
          : `转写完成，共 ${String(characters)} 字。文件已写入：${value.transcriptPath}\n\n${value.preview}`
        return [{ type: 'text', text: value.note === undefined ? summary : `${value.note}\n${summary}` }]
      },
      presentationMeta(_args, value) {
        return value.transcriptPath === undefined
          ? { kind: 'transcript', characters: 0 }
          : { kind: 'transcript', transcriptPath: value.transcriptPath, characters: value.characters ?? 0 }
      },
    },
    async execute(args, exec) {
      const audioPath = resolveRequestedPath(args.audioPath, exec.agent?.session.header.cwd)
      const info = await statRecording(args.audioPath, audioPath)
      if (!info.isFile()) {
        throw new Error(`无法转写「${args.audioPath}」：该路径是目录，不是音频文件。`)
      }
      if (info.size > MAX_SOURCE_BYTES) {
        throw new Error(`无法转写「${args.audioPath}」：文件超过 2 GiB 上限。`)
      }
      const tempDir = await mkdtemp(join(tmpdir(), 'dsh-speech-transcribe-run-'))
      try {
        const audio = await prepareSpeechAudio({
          inputPath: audioPath,
          inputBytes: info.size,
          tempDir,
          platform: process.platform,
          maxAudioMinutes: config.maxAudioMinutes,
          signal: exec.signal,
          resolve: executableResolver(ctx.subprocess, exec.signal),
          runner: subprocessRunner(ctx.subprocess),
        })
        const decision = readinessOf(ctx.speechToText.snapshot(), args.providerId)
        if (decision.kind === 'blocked') return { preview: decision.message }
        const spec = ctx.speechToText.resolve({
          audio,
          ...args.providerId === undefined ? {} : { providerId: args.providerId as SpeechProviderId },
          ...args.language === undefined ? {} : { language: args.language },
        })
        const transcript = await ctx.speechToText.transcribe(spec, exec.signal)
        const text = transcript.text.trim()
        const written = await writeTranscriptFile(audioPath, renderTranscript({
          sourceName: basename(audioPath),
          transcript,
          providerId: spec.provider.info.id,
          providerName: spec.provider.info.name,
          generatedAt: new Date(),
        }))
        return {
          transcriptPath: written.path,
          characters: text.length,
          preview: text.slice(0, PREVIEW_CHARS),
          ...written.note === undefined ? {} : { note: written.note },
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    },
  }))
}

/**
 * Write one transcript beside its recording without replacing an existing
 * file: the first collision takes `<stem>.transcript.2.md`, then increments.
 * @param audioPath - absolute recording path, which fixes directory and stem.
 * @param content - complete transcript Markdown.
 * @returns the written path, and a Chinese note when a collision changed the name.
 * @throws when the write fails; the message names only the recording's base name.
 */
async function writeTranscriptFile(
  audioPath: string,
  content: string,
): Promise<{ path: string; note?: string }> {
  const directory = dirname(audioPath)
  const stem = parse(audioPath).name
  let collision = false
  for (let index = 1; index <= MAX_TRANSCRIPT_ATTEMPTS; index += 1) {
    const name = index === 1 ? `${stem}.transcript.md` : `${stem}.transcript.${String(index)}.md`
    const path = join(directory, name)
    try {
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
      return collision ? { path, note: `同名文字稿已存在，本次写入「${name}」。` } : { path }
    } catch (error: unknown) {
      if (!isErrnoCode(error, 'EEXIST')) {
        throw new Error(`无法写入「${basename(audioPath)}」的文字稿文件，请检查该目录是否可写。`, { cause: error })
      }
      collision = true
    }
  }
  throw new Error(`无法写入「${basename(audioPath)}」的文字稿文件：同名文件过多。`)
}

/** Resolve a requested recording path against the session workspace. */
function resolveRequestedPath(requestedPath: string, cwd: string | undefined): string {
  if (isAbsolute(requestedPath)) return requestedPath
  if (cwd === undefined) {
    throw new Error(`无法解析相对路径「${requestedPath}」：当前调用没有会话工作目录，请改用绝对路径。`)
  }
  return resolve(cwd, requestedPath)
}

/** Stat the recording, mapping any failure to a Chinese read diagnostic. */
async function statRecording(requestedPath: string, audioPath: string) {
  try {
    return await stat(audioPath)
  } catch {
    // A missing file and a permission denial share one remedy: check the path.
    throw new Error(`无法读取音频文件「${requestedPath}」：文件不存在或没有读取权限。`)
  }
}
