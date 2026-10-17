/** Filesystem failure controls for atomic wiki index publication and recovery. */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it('preserves curated indexes on interrupted writes, failed replacement and concurrent edits', async () => {
  const script = fileURLToPath(new URL('./helpers/index-publication-controls.py', import.meta.url))
  const { stdout } = await execFileAsync(process.env.ASK_KNOWLEDGE_PYTHON ?? 'python3', [script])
  expect(JSON.parse(stdout.trim())).toEqual({ passed: 3, tests: 3 })
})
