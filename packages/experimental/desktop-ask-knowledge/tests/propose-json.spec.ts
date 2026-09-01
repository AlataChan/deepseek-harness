/** Vendored propose helpers: JSON unwrap and raw clip. */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '../python/kb/src')
const script = join(here, 'helpers/propose-json-check.py')

describe('propose json helpers', () => {
  it('parses fenced JSON, keeps model text, and clips long raw', () => {
    const output = execFileSync('python3', [script], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: src },
    }).trim()
    expect(output).toBe('ok')
  })
})
