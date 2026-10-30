import { defineConfig } from 'tsdown'

/** Build each isolated process role as one complete Node entry without shared chunks. */
export default defineConfig(['index', 'runtime-plugin', 'ingress-plugin', 'desktop'].map(entry => ({
  entry: { [entry]: `lib/types/${entry}.js` },
  outDir: 'lib',
  format: ['esm' as const],
  platform: 'node' as const,
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
})))
