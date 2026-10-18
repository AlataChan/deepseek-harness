/**
 * Long-recording transcription entry for octopus_DSH: one model-visible
 * `speech_transcribe` tool over the speech-to-text seam, writing a Markdown
 * transcript beside the recording, plus the Host staging service behind the
 * 录音转文字 hero entry.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-subprocess'
import { TranscriptAudio } from './staging.ts'
import type { TranscriptAudioConfig } from './staging.ts'
import { registerSpeechTranscribeTool, type SpeechTranscribeConfig } from './tool.ts'

export {
  CANONICAL_WAVE_HEADER_BYTES,
  WAVE_PREFIX_BYTES,
  canonicalizeDecodedWave,
  decoderArgv,
  isCanonicalSpeechWave,
  prepareSpeechAudio,
  resolveDecoder,
} from './audio.ts'
export type {
  AudioCommandOutcome,
  AudioCommandRunner,
  Decoder,
  DecoderKind,
  PrepareSpeechAudioOptions,
} from './audio.ts'
export {
  RECORDINGS_DIRECTORY,
  TranscriptAudio,
  TranscriptAudioError,
  isErrnoCode,
  sanitizeRecordingName,
} from './staging.ts'
export type { StagedTranscriptAudio, TranscriptAudioConfig, TranscriptAudioErrorCode } from './staging.ts'
export {
  executableResolver,
  MAX_SOURCE_BYTES,
  readinessOf,
  registerSpeechTranscribeTool,
  subprocessRunner,
} from './tool.ts'
export type { ReadinessDecision, SpeechTranscribeConfig } from './tool.ts'
export { formatClock, formatDate, formatInference, renderTranscript } from './transcript.ts'
export type { TranscriptDocumentOptions } from './transcript.ts'

/** Loader-facing plugin name. */
export const name = 'desktop-speech-transcribe'

/** Required services; the optional voice-input registry is resolved for each tool call. */
export const inject = ['tools', 'subprocess']

/** Limits shared by the transcription tool and recording staging service. */
export type Config = SpeechTranscribeConfig & TranscriptAudioConfig

/** Runtime validation for the transcription and staging limits. */
export const Config: z<Config> = z.object({
  maxAudioMinutes: z.natural().default(120),
  maxUploadMiB: z.natural().min(1).default(64),
})

/**
 * Register the transcription tool and the `ctx.transcriptAudio` staging
 * service; both are disposed with the plugin fiber.
 * @param ctx - Host context holding tools, the speech registry, and the subprocess seam.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => registerSpeechTranscribeTool(ctx, config), 'desktop-speech-transcribe.tools')
  new TranscriptAudio(ctx, config)
}

/** Function-plugin form for the Loader: name, required services, config schema, and apply. */
export default { name, inject, Config, apply }
