/** PDF Kangxi radicals and titles must match typed 一老一小. */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '../python/kb/src')
const script = join(here, 'helpers/retrieve-fold-check.py')

describe('retrieve fold', () => {
  it('hits a raw page whose body uses Kangxi radicals, or whose title carries the term', () => {
    const output = execFileSync('python3', [script], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: src },
    }).trim()
    expect(output).toBe('ok')
  })
})
