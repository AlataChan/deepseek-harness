import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ask-data',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true },
)
