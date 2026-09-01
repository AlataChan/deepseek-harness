/** Catalog create, list, rename, remove, escape, and concurrent writes. */

import { mkdir, readFile, symlink } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { BOOTSTRAP_CONFIG_TOML } from '../src/bootstrap-vault.ts'
import {
  catalogPath, createCatalogLibrary, listCatalog, readCatalog, removeCatalogLibrary,
  renameCatalogLibrary, requireLibrary, resumeDeleting, writeCatalog,
} from '../src/catalog.ts'
import { resolveKnowledgeHome } from '../src/knowledge-home.ts'

describe('ask-knowledge catalog', () => {
  it('creates a vault with DeepSeek config and lists it first after a later create', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-catalog-'))
    const first = await createCatalogLibrary(home, '制度 A')
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await createCatalogLibrary(home, '制度 B')
    const listed = await listCatalog(home)
    expect(listed.map(row => row.id)).toEqual([second.id, first.id])
    const config = await readFile(
      join(home, 'knowledge-bases', 'libraries', first.id, '.octopus-kb', 'config.toml'),
      'utf8',
    )
    expect(config).toBe(BOOTSTRAP_CONFIG_TOML)
    expect(config).not.toContain('11434')
    expect(config).not.toContain('qwen')
  })

  it('renames and removes a library including a deleting resume', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-remove-'))
    const created = await createCatalogLibrary(home, '旧名')
    const renamed = await renameCatalogLibrary(home, created.id, '新名')
    expect(renamed.displayName).toBe('新名')
    const document = await readCatalog(home)
    await writeCatalog(home, {
      version: 1,
      libraries: document.libraries.map(row => row.id === created.id ? { ...row, deleting: true } : row),
    })
    await resumeDeleting(home)
    expect(await listCatalog(home)).toEqual([])
    await expect(requireLibrary(home, created.id)).rejects.toMatchObject({ code: 'library-missing' })
  })

  it('keeps both rows when two creates overlap', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-race-'))
    const [a, b] = await Promise.all([
      createCatalogLibrary(home, '甲'),
      createCatalogLibrary(home, '乙'),
    ])
    const listed = await listCatalog(home)
    expect(listed).toHaveLength(2)
    expect(new Set(listed.map(row => row.id))).toEqual(new Set([a.id, b.id]))
  })

  it('rejects a vaultRelPath that leaves knowledge-bases/', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-escape-'))
    await mkdir(join(home, 'knowledge-bases'), { recursive: true })
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id: AskKnowledgeLibraryId('00000000-0000-0000-0000-000000000001'),
        displayName: '逃',
        createdAt: '2026-08-31T00:00:00.000Z',
        lastUsedAt: '2026-08-31T00:00:00.000Z',
        vaultRelPath: 'libraries/../outside',
      }],
    })
    await expect(listCatalog(home)).rejects.toMatchObject({ code: 'path-escape' })
  })

  it('rejects a symlink that leaves knowledge-bases/', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'ask-knowledge-outside-'))
    const created = await createCatalogLibrary(home, '链')
    const vault = join(home, 'knowledge-bases', 'libraries', created.id)
    await removeCatalogLibrary(home, created.id)
    await mkdir(join(home, 'knowledge-bases', 'libraries'), { recursive: true })
    await symlink(outside, vault)
    await writeCatalog(home, {
      version: 1,
      libraries: [{
        id: created.id,
        displayName: '链',
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        vaultRelPath: `libraries/${created.id}`,
      }],
    })
    await expect(listCatalog(home)).rejects.toMatchObject({ code: 'path-escape' })
  })

  it('writes catalog.json through rename so readers never see a partial file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-atomic-'))
    await createCatalogLibrary(home, '原子')
    const raw = await readFile(catalogPath(home), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(raw.endsWith('\n')).toBe(true)
  })

  it('resolves knowledgeHome from config or OCTOPUS_APP_DATA and fails loud otherwise', () => {
    expect(resolveKnowledgeHome({ knowledgeHome: '/tmp/kb-home' })).toBe('/tmp/kb-home')
    expect(resolveKnowledgeHome({}, { OCTOPUS_APP_DATA: '/tmp/from-env' })).toBe('/tmp/from-env')
    expect(() => resolveKnowledgeHome({}, {})).toThrow(AskKnowledgeError)
    expect(() => resolveKnowledgeHome({ knowledgeHome: 'relative' })).toThrow(AskKnowledgeError)
  })
})
