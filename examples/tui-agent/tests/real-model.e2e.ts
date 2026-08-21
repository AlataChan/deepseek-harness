import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import { resolveTuiTerminalLaunch, runTuiTerminal } from './fixtures/terminal-driver.ts'

const dshSource = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const dshBuilt = fileURLToPath(new URL('../../../apps/cli/lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const patchPath = fileURLToPath(new URL('../cordis.yml', import.meta.url))
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

describe.skipIf(process.platform === 'win32' || !hasKey)('tui-agent with real model', () => {
  it('modifies a sentinel through the real terminal composition', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-real-'))
    const sentinel = join(cwd, 'task.txt')
    await writeFile(sentinel, 'value=before\n')
    try {
      const launch = resolveTuiTerminalLaunch({
        mode: resolveExampleMode(), dshSource, dshBuilt, tsconfigPath, patchPath,
        cwd, dshHome: join(cwd, '.dsh'),
        args: ['Read task.txt, replace its complete contents with exactly "value=after" followed by a newline, read it again, and report briefly.'],
      })
      const result = await runTuiTerminal({
        cwd,
        launch,
        timeoutMs: 120_000,
        actions: [
          { waitFor: 'Status: running' },
          { waitFor: 'Status: ready', text: '/exit' },
          { key: 'return' },
        ],
      })
      expect(await readFile(sentinel, 'utf8')).toBe('value=after\n')
      expect(result.output).toContain('Status: ready')
      expect(result.rawModeRestored).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }, 135_000)
})
