import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-files',
  ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/list-entries.js'],
)
