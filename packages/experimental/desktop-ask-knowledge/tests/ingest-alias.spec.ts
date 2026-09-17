/** Ingest applies pages that share tags, a digest named like its source, and still rejects a real collision. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '../python/kb/src')
const script = join(here, 'helpers/ingest-alias-check.py')
const venvPython = join(here, '../../../../dist/.cache/kb-sidecar-build/venv/bin/python')
const python = existsSync(venvPython) ? venvPython : 'python3'

describe('ask-knowledge ingest aliases', () => {
  it('keeps shared tags off the alias index, ignores source pages, and still rejects a real collision', () => {
    const output = execFileSync(python, [script], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: src },
    }).trim()
    expect(output).toBe('ok')
  })
})
