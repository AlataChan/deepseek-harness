import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-media',
  ['lib/types/index.js'],
  { hostPhase: true },
)
