import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ngo',
  ['lib/types/index.js'],
  { hostPhase: true },
)
