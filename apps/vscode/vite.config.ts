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
      { find: /^@deepseek-ai\/dsh-client-web$/, replacement: src('../../packages/client/web/src/boot.tsx') },
      { find: /^@deepseek-ai\/dsh-client-web-react$/, replacement: src('../../packages/client/web-react/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-slots$/, replacement: src('../../packages/client/ui-slots/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-primitives$/, replacement: src('../../packages/client/ui-primitives/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-attachment$/, replacement: src('../../packages/client/ui-attachment/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-schema-form$/, replacement: src('../../packages/client/schema-form/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-modules\/client$/, replacement: src('../../packages/client/modules/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-connection-vscode\/client$/, replacement: src('../../packages/client/connection-vscode/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-connection-vscode\/protocol$/, replacement: src('../../packages/client/connection-vscode/src/protocol.ts') },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
