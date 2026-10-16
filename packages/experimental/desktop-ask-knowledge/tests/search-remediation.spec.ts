/** Synthetic regression controls for search authorization and bounded reading. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
it('preserves complete authorized source reading within serialized result allowances', async () => {
  const script = fileURLToPath(new URL('./search-remediation-controls.py', import.meta.url))
  const result = await promisify(execFile)('python3', ['-W', 'error::ResourceWarning', script])
  expect(result.stderr).toContain('OK')
})
