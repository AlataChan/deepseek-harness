import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ask-knowledge',
  ['lib/types/index.js', 'lib/types/converter-worker.js'],
  { hostPhase: true },
)
