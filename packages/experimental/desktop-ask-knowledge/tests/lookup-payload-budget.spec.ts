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
it('returns bounded CJK lookup text with canonical attribution and truncation disclosure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lookup-budget-')); roots.push(root)
  const home = join(root, 'sidecar'); await installFakeSidecar(home)
  await writeFakeSidecarEnv(home, { ASK_KNOWLEDGE_FAKE_LOOKUP_JSON: JSON.stringify({ canonicalPath: 'wiki/机构规定.md', text: '正文'.repeat(6000) }) })
  const library = await createCatalogLibrary(root, 'library')
  const result = await lookupLibraryTerm({ sidecarRuntimePath: home }, root, library.id, '机构规定', { maxItems: 12, maxChars: 24000, maxTokens: 6000 })
  expect(result.term).toBe('机构规定')
  expect(result.canonicalPath).toBe('wiki/机构规定.md')
  expect(result.text).toBeTruthy()
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(6000)
  expect(result.warnings.some(warning => warning.ruleId === 'result-truncated')).toBe(true)
})
