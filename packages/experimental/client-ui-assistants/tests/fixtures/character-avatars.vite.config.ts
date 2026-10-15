/** Isolated visual fixture; Vite serves only a test UI on loopback. */
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0, strictPort: true },
})
