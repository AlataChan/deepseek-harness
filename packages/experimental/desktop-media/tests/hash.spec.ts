import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256Bytes, sha256File } from '../src/hash.ts'

describe('hash', () => {
  it('hashes files and bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-media-hash-'))
    const path = join(root, 'a.bin')
    await writeFile(path, 'abc')
    const expected = createHash('sha256').update('abc').digest('hex')
    expect(await sha256File(path)).toBe(expected)
    expect(sha256Bytes(new Uint8Array([97, 98, 99]))).toBe(expected)
  })
})
