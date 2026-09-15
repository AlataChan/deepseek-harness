import { clientBundle } from '../../client/tsdown.client.ts'
import type { UserConfig } from 'tsdown'

function companion(name: 'tools' | 'preset'): UserConfig {
  return {
    name: `@deepseek-ai/dsh-experimental-commerce-mode/${name}`,
    entry: { [name]: `lib/types/${name}/index.js` },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    outputOptions: { codeSplitting: false },
  }
}

export default clientBundle(
  '@deepseek-ai/dsh-experimental-commerce-mode',
  ['lib/types/index.js'],
  { hostPhase: true, companions: [companion('tools'), companion('preset')] },
)
