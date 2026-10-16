/** Verify durable UTF-8 files independently of the Host's default text codec. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { PROCESS_INTEGRATION_TIMEOUT } from './helpers/process-integration-timeout.ts'

it('preserves Chinese plans, checkpoints and diagnostics with a CP1252 file default', async () => {
  const script = fileURLToPath(new URL('./file-encoding-controls.py', import.meta.url))
  const result = await promisify(execFile)('python3', ['-W', 'error::ResourceWarning', script], { timeout: 15000 })
  expect(result.stderr).toContain('Ran 4 tests')
  expect(result.stderr).toContain('OK')
}, PROCESS_INTEGRATION_TIMEOUT)
