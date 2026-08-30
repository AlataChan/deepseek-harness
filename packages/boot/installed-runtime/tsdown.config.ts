import { defineConfig } from 'tsdown'

const shared = {
  outDir: 'lib',
  format: ['esm'] as const,
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** `cli.js` is copied alone into the desktop `.app`; it cannot import sibling files. */
export default defineConfig([
  {
    ...shared,
    entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  },
  {
    ...shared,
    entry: ['lib/types/cli.js'],
    outputOptions: { codeSplitting: false },
  },
])
