import { clientBundle } from '../../client/tsdown.client.ts'
import type { UserConfig } from 'tsdown'

const spreadsheet: UserConfig = {
  name: '@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet',
  entry: ['lib/types/spreadsheet.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
}

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-ask-data',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true, companions: [spreadsheet] },
)
