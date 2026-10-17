/** Lookup keeps its legacy fields while bounding the final serialized response. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createCatalogLibrary } from '../src/catalog.ts'
import { lookupLibraryTerm } from '../src/retrieve.ts'
import { installFakeSidecar, writeFakeSidecarEnv } from './helpers/install-sidecar.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it('refuses a sidecar that ignores pagination bounds instead of silently clipping its text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lookup-budget-')); roots.push(root)
  const home = join(root, 'sidecar'); await installFakeSidecar(home)
  await writeFakeSidecarEnv(home, { ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({ canonicalPath: 'wiki/机构规定.md', text: '正文'.repeat(6000) }) })
  const library = await createCatalogLibrary(root, 'library')
  await expect(lookupLibraryTerm({ sidecarRuntimePath: home }, root, library.id, '机构规定', { maxItems: 12, maxChars: 24000, maxTokens: 6000 }))
    .rejects.toThrow('lookup metadata exceeds the payload allowance')
})
