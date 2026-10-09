import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ask-knowledge',
  ['lib/types/index.js'],
  { hostPhase: true },
)
