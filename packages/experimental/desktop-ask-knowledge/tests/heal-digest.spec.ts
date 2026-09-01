/** Rejected propose digests must apply after page-meta fill. */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '../python/kb/src')
const script = join(here, 'helpers/heal-digest-check.py')
const venvPython = join(here, '../../../../dist/.cache/kb-sidecar-build/venv/bin/python')
const python = existsSync(venvPython) ? venvPython : 'python3'

describe('ask-knowledge digest heal', () => {
  it('applies a page-meta rejection and lets lookup resolve the wiki title from a tag', () => {
    const output = execFileSync(python, [script], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: src },
    }).trim()
    expect(output).toBe('ok')
  })
})
