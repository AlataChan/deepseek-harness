/** Archive staging refuses a bad digest and copies only the built flock runtime. */
import { open, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { copyAddonRuntime, stageAssets } from './stage-agent-desktop-assets.ts'
import { verifyAssets } from './verify-agent-desktop-digest.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const packageRoot = join(repoRoot, 'packages', 'experimental', 'desktop-operation')
const archive = process.env.AD01_ARCHIVE
if (process.env.AD01_REQUIRE_ARCHIVE === '1' && (archive === undefined || archive === '')) {
  throw new Error('AD01_ARCHIVE is required')
}

describe('stage agent-desktop assets', () => {
  it('refuses a digest mismatch before extract', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-stage-bad-'))
    try {
      const bad = join(dir, 'bad.tar.gz')
      const dest = join(dir, 'plugin')
      await writeFile(bad, 'not-the-pinned-archive')
      await expect(stageAssets({ archive: bad, dest, packageRoot, repoRoot })).rejects.toThrow(/digest mismatch/)
      await expect(stat(join(dest, 'native', 'agent-desktop'))).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses a missing built flock runtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ad01-stage-runtime-'))
    try {
      await expect(copyAddonRuntime(dir, join(dir, 'plugin'))).rejects.toThrow(/built runtime is absent/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(archive === undefined || archive === '')('pinned agent-desktop archive', () => {
  it('stages runtime files only and the staged flock locks a descriptor', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'ad01-stage-'))
    try {
      await stageAssets({ archive: archive ?? '', dest, packageRoot, repoRoot })
      await verifyAssets({ root: dest, signed: false })
      await expectRuntimeTree(join(dest, 'node_modules'))
      const loaded: unknown = await import(pathToFileURL(join(dest, 'node_modules', '@deepseek-ai', 'node-addon-system', 'lib', 'flock.js')).href)
      const lock = callable(loaded, 'tryLockExclusive')
      const handle = await open(join(dest, 'probe.lock'), 'a+')
      try {
        await lock(handle.fd)
      } finally {
        await handle.close()
      }
    } finally {
      await rm(dest, { recursive: true, force: true })
    }
  })
})

async function expectRuntimeTree(root: string): Promise<void> {
  const banned = new Set(['src', 'tests', '.bin'])
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (banned.has(entry.name)) throw new Error(`staged tree contains ${entry.name}`)
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`staged tree contains a symlink ${path}`)
      if (entry.isDirectory()) pending.push(path)
      expect(path.split(sep).some(part => banned.has(part))).toBe(false)
    }
  }
}

function callable(loaded: unknown, key: string): (fd: number) => Promise<void> {
  if (typeof loaded !== 'object' || loaded === null || !(key in loaded)) {
    throw new Error(`staged flock is missing ${key}`)
  }
  const value: unknown = Object.getOwnPropertyDescriptor(loaded, key)?.value
  if (typeof value !== 'function') throw new Error(`staged flock ${key} is not a function`)
  return (fd: number) => Promise.resolve(Reflect.apply(value, undefined, [fd])).then(() => {})
}
