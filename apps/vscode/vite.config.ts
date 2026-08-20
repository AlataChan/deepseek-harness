import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

/** Build the retained Webview shell with fixed external-resource filenames. */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/webview',
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: src('./src/webview/main.tsx'),
      formats: ['es'],
      fileName: () => 'main.js',
      cssFileName: 'main',
    },
  },
  resolve: {
    alias: [
      { find: /^node:module$/, replacement: src('./src/webview/node-module-stub.ts') },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
