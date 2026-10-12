import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-speech-transcribe',
  ['lib/types/index.js'],
  { hostPhase: true },
)
