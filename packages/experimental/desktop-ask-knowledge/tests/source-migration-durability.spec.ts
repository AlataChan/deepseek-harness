/** Run the WAL rollback regression against the source-plane Python package. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
it('restores migration failures from a coherent SQLite WAL snapshot', async () => {
  const script = fileURLToPath(new URL('./source-migration-controls.py', import.meta.url))
  const result = await promisify(execFile)('python3', ['-W', 'error::ResourceWarning', script])
  expect(result.stderr).toContain('OK')
})
