/** Overlay manifest: create/list/missing, version, path fence, symlink escape. */

import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AskDataConnectionRef, type AskDataSourceId } from '@deepseek-ai/dsh-host-ask-data'
import {
  assertInsideImport, ManifestError, readManifest, toListSource, writeManifest,
} from '../src/manifest.ts'
import { listManagedSources, putStoredSource } from '../src/sources.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ask-data-manifest-'))
}

describe('ask-data manifest', () => {
  it('lists an empty document when the file is absent', async () => {
    const home = await tempHome()
    await expect(readManifest(home)).resolves.toEqual({ version: 1, sources: [] })
    await expect(listManagedSources(home)).resolves.toEqual([])
  })

  it('writes, lists, and marks a vanished sqlite as missing', async () => {
    const home = await tempHome()
    const id = brandString<AskDataSourceId>('src-1')
    await putStoredSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const listed = await listManagedSources(home)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.missing).toBe(true)
    expect(listed[0]?.displayName).toBe('sales.csv')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'data.sqlite'), 'x')
    const present = await toListSource(home, {
      id,
      displayName: 'sales.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      connectionRef: AskDataConnectionRef('ask-data:src-1'),
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      warnings: ['header-empty'],
    })
    expect(present.missing).toBe(false)
    expect(present.connectionRef).toBe('ask-data:src-1')
    expect(present.lastUsedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects an unknown manifest version and invalid JSON', async () => {
    const home = await tempHome()
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'manifest.json'), '{"version":2,"sources":[]}\n')
    await expect(readManifest(home)).rejects.toMatchObject({ code: 'manifest-version' })
    await writeFile(join(home, 'manifest.json'), '{')
    await expect(readManifest(home)).rejects.toBeInstanceOf(ManifestError)
    await writeFile(join(home, 'manifest.json'), '{"version":1,"sources":[{}]}\n')
    await expect(readManifest(home)).rejects.toMatchObject({ code: 'manifest-invalid' })
  })

  it('rejects a path that leaves the import directory', async () => {
    const home = await tempHome()
    const id = brandString<AskDataSourceId>('src-1')
    await expect(assertInsideImport(home, id, '../escape.sqlite')).rejects.toMatchObject({
      code: 'path-escape',
    })
  })

  it('rejects a symlink that leaves the data-sources root', async () => {
    const home = await tempHome()
    const id = brandString<AskDataSourceId>('src-1')
    const dir = join(home, 'imports', 'src-1')
    await mkdir(dir, { recursive: true })
    const outside = join(home, '..', 'outside.sqlite')
    await writeFile(outside, 'x')
    const link = join(dir, 'data.sqlite')
    await symlink(outside, link)
    await expect(assertInsideImport(home, id, 'data.sqlite')).rejects.toMatchObject({
      code: 'path-escape',
    })
  })

  it('rethrows a non-ENOENT read failure', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'manifest.json'), { recursive: true })
    await expect(readManifest(home)).rejects.toBeDefined()
  })

  it('fails when the manifest path is a directory', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'manifest.json'))
    await expect(writeManifest(home, { version: 1, sources: [] })).rejects.toBeDefined()
  })
})
