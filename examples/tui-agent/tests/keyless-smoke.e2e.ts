import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import { resolveTuiTerminalLaunch, runTuiTerminal } from './fixtures/terminal-driver.ts'

const dshSource = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const dshBuilt = fileURLToPath(new URL('../../../apps/cli/lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const patchPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))

describe.skipIf(process.platform === 'win32')('tui-agent keyless smoke', () => {
  it('boots the real Loader tree, serves local help, and restores the terminal on exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-keyless-'))
    try {
      const launch = resolveTuiTerminalLaunch({
        mode: resolveExampleMode(), dshSource, dshBuilt, tsconfigPath, patchPath,
        cwd, dshHome: join(cwd, '.dsh'),
      })
      const result = await runTuiTerminal({
        cwd,
        launch,
        timeoutMs: 30_000,
        actions: [
          { waitFor: 'You › Type a message', text: '/help' },
          { key: 'return' },
          { waitFor: '/exit — Exit after saving the current session', key: 'ctrl-c' },
        ],
      })
      expect(result.output).toContain('DeepSeek Harness · dsh')
      expect(result.output).toContain('/resume — Choose another saved session')
      expect(result.output).toContain('/exit — Exit after saving the current session')
      expect(result.exitCode).toBe(0)
      expect(result.rawModeRestored).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
