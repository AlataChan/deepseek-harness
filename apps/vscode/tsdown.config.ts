import { defineConfig } from 'tsdown'

/** Build the workspace-extension host while keeping VS Code's runtime API external. */
export default defineConfig({
  entry: { extension: 'lib/types/src/extension.js' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: { neverBundle: ['vscode'] },
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  dts: false,
  sourcemap: false,
})
