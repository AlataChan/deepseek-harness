import { defineConfig } from 'tsdown'

/** Build the workspace-extension host while keeping VS Code's runtime API external. */
export default defineConfig({
  entry: { extension: 'lib/types/src/extension.js' },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  deps: {
    alwaysBundle: [
      /^@deepseek-ai\/dsh-client-connection-vscode(?:\/|$)/,
      /^@deepseek-ai\/dsh-host-apiproxy(?:\/|$)/,
      /^zod(?:\/|$)/,
    ],
    neverBundle: ['vscode'],
    onlyBundle: false,
  },
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  dts: false,
  sourcemap: false,
})
