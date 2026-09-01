import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ask-knowledge',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
