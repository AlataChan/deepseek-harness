/** Test-only recognizer returning fixed text through the real speech registry. */
import type { Context } from '@deepseek-ai/cordis'
import type { SpeechProviderId, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text'

/** Fixed recognition result the composed tool writes into its transcript. */
export const RESULT: Transcript = { text: '组合转写成功。', audioSeconds: 1, inferenceSeconds: 0.5 }

/** Provider id the composition selects as its default. */
export const PROVIDER_ID = 'stub-local'

/** Required service: the composition's real speech registry. */
export const inject = ['speechToText']

/**
 * Register one deterministic recognizer on the composed speech service.
 * @param ctx - composition context carrying the speech registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.speechToText.register({
    info: {
      id: PROVIDER_ID as SpeechProviderId,
      name: 'Stub Recognizer',
      location: 'host-local',
      languages: ['auto', 'zh'],
    },
    transcribe: async () => RESULT,
  }))
}
