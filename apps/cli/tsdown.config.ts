import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the public `bin` and the module path VS Code forks through
 * `dsh.companions.vscode`. The root tsdown builds only `lib/types/index.js`,
 * so this override names both app-owned entries explicitly.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: {
    bin: 'lib/types/bin.js',
    'vscode-companion': 'lib/types/vscode-companion.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
