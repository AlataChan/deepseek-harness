import { clientBundle } from '../../client/tsdown.client.ts'
import type { UserConfig } from 'tsdown'

const supervisor: UserConfig = {
  name: '@deepseek-ai/dsh-experimental-desktop-operation/supervisor',
  entry: { supervisor: 'lib/types/supervisor.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { codeSplitting: false, entryFileNames: 'supervisor.js' },
  deps: {
    neverBundle: (specifier: string) => specifier === '@deepseek-ai/node-addon-system'
      || specifier.startsWith('@deepseek-ai/node-addon-system/'),
  },
}

export default clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-operation',
  ['lib/types/index.js'],
  { hostPhase: true, companions: [supervisor] },
)
