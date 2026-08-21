import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const fixture = fileURLToPath(new URL('./fixtures/source-launch.ts', import.meta.url))

describe('TUI source launch JSX', () => {
  it('runs through the repository tsx loader without a global React binding', async () => {
    const { stdout, stderr } = await execute(process.execPath, ['--import', 'tsx/esm', fixture], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
    })
    expect(stderr).toBe('')
    expect(stdout).toContain('DeepSeek Harness · dsh')
  })
})
