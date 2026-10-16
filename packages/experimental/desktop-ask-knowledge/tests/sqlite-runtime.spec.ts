/**
 * SQLite runtime and FTS5 trigram preflight tests.
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const RUNTIME_CHECK_PY = fileURLToPath(
  new URL('../python/documents/runtime_check.py', import.meta.url),
)

describe('sqlite runtime preflight', () => {
  it('executes runtime_check.py successfully and reports fts5 and trigram', async () => {
    const python = process.env.ASK_KNOWLEDGE_PYTHON ?? 'python3'
    const { stdout, stderr } = await execFileAsync(python, [RUNTIME_CHECK_PY])
    expect(stderr).toBe('')
    const parsed = JSON.parse(stdout.trim())
    expect(parsed.ok).toBe(true)
    expect(parsed.fts5).toBe(true)
    expect(parsed.trigram).toBe(true)
    expect(typeof parsed.sqlite_version).toBe('string')
    expect(parsed.sqlite_version.length).toBeGreaterThan(0)
  })
})
