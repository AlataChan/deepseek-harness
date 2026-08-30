import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const src = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

function literalLoaderConfig(): Plugin {
  const evaluator = [
    'const evaluate = new Function("ctx", "expr", `',
    '  with (ctx) {',
    '    return eval(expr)',
    '  }',
    '`);',
  ].join('\n')
  const refusal = 'function evaluate() { throw new Error("desktop WebView loader configs must not contain !!js expressions"); }'
  return {
    name: 'dsh-desktop-literal-loader-config',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?', 1)[0]?.replaceAll('\\', '/')
      if (!normalizedId?.endsWith('/vendor/loader/lib/index.js')) return
      const first = code.indexOf(evaluator)
      if (first < 0 || code.indexOf(evaluator, first + evaluator.length) >= 0) {
        throw new Error('desktop WebView expected exactly one vendored Loader config evaluator')
      }
      return { code: code.replace(evaluator, refusal), map: null }
    },
  }
}

/** Build the desktop WebView from `index.html`. */
export default defineConfig({
  plugins: [literalLoaderConfig(), react()],
  root: src('.'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: [
      { find: /^node:module$/, replacement: src('./src/node-module-stub.ts') },
    ],
  },
  define: {
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env': '{"NODE_ENV":"production"}',
  },
})
