/**
 * Long-recording transcription entry for octopus_DSH: one model-visible
 * `speech_transcribe` tool over the speech-to-text seam, writing a Markdown
 * transcript beside the recording.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-subprocess'
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

/** Services the tool reads at load and call time. */
export const inject = ['tools', 'speechToText', 'subprocess']

/** Runtime validation for {@link SpeechTranscribeConfig}. */
export const Config: z<SpeechTranscribeConfig> = z.object({
  maxAudioMinutes: z.natural().default(120),
})

/**
 * Register the transcription tool; disposed with the plugin fiber.
 * @param ctx - Host context holding tools, the speech registry, and the subprocess seam.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: SpeechTranscribeConfig): void {
  ctx.effect(() => registerSpeechTranscribeTool(ctx, config), 'desktop-speech-transcribe.tools')
}

/** Function-plugin form for the Loader: name, required services, config schema, and apply. */
export default { name, inject, Config, apply }
