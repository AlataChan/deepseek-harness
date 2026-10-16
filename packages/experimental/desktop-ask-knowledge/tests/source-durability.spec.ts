/** Regression controls for private uploads and immutable source publication. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { DocumentId } from '../src/document-types.ts'
import { readSourceOriginal, storeSourceOriginal } from '../src/source-store.ts'
import { appendUpload, beginUpload, materializeUpload } from '../src/upload-temp.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'source-durability-')); roots.push(root)
  const libraryId = AskKnowledgeLibraryId('22222222-2222-2222-2222-222222222222')
  const vault = join(root, 'knowledge-bases', 'libraries', libraryId)
  await mkdir(vault, { recursive: true })
  await writeFile(join(root, 'knowledge-bases', 'catalog.json'), JSON.stringify({ version: 1, libraries: [{ id: libraryId, displayName: 'test', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), vaultRelPath: `libraries/${libraryId}` }] }))
  const sidecarRuntimePath = join(root, 'sidecar'); await installPythonSidecar(sidecarRuntimePath)
  return { root, vault, libraryId, config: { sidecarRuntimePath } }
}
it('streams accepted upload chunks to a private file before materialization', async () => {
  const { root, libraryId } = await setup()
  const upload = await beginUpload(root, libraryId, 'input.md')
  appendUpload(upload, Buffer.from('first'), 1024)
  expect(await readFile(upload.path, 'utf8')).toBe('first')
  expect((await stat(upload.dir)).mode & 0o777).toBe(0o700)
  expect((await stat(upload.path)).mode & 0o777).toBe(0o600)
  appendUpload(upload, Buffer.from('second'), 1024)
  await materializeUpload(upload)
  expect(await readFile(upload.path, 'utf8')).toBe('firstsecond')
})
it('refuses to overwrite corrupted bytes at an existing immutable revision', async () => {
  const { root, vault, libraryId, config } = await setup()
  const content = Buffer.from('original'); const doc = DocumentId('doc-immutable')
  const stored = await storeSourceOriginal(config, root, libraryId, 'one.md', content, doc)
  await writeFile(join(vault, stored.objectPath), 'tampered')
  await expect(storeSourceOriginal(config, root, libraryId, 'one.md', content, doc)).rejects.toThrow()
  expect(await readFile(join(vault, stored.objectPath), 'utf8')).toBe('tampered')
})
it('refuses a source ancestor redirected to an external directory even for matching bytes', async () => {
  const { root, vault, libraryId, config } = await setup()
  const stored = await storeSourceOriginal(config, root, libraryId, 'one.md', Buffer.from('original'))
  const sources = join(vault, '.octopus-kb', 'sources'); const outside = join(root, 'outside')
  await rename(sources, outside); await symlink(outside, sources)
  await expect(readSourceOriginal(config, root, libraryId, stored.revision.revisionId)).rejects.toThrow()
})
it('replays a durable pending registration after source publication', async () => {
  const { root, vault, libraryId, config } = await setup()
  const documentId = DocumentId('doc-pending'); const bytes = Buffer.from('recover me')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const revision = `rev-${createHash('sha256').update(`${documentId}:${sha256}`).digest('hex').slice(0, 16)}`
  const dir = join(vault, '.octopus-kb', 'sources', revision); await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'original'), bytes)
  await writeFile(join(dir, 'registration.json'), JSON.stringify({ command: 'register-source-revision', vault, documentId, libraryId, filename: 'recovered.md', sha256, byteLength: bytes.length, objectPath: `.octopus-kb/sources/${revision}/original` }))
  await storeSourceOriginal(config, root, libraryId, 'next.md', Buffer.from('next'))
  expect(await readFile(join(dir, 'registered'), 'utf8')).toBe('registered\n')
})
it('publishes async source chunks without requiring an assembled buffer', async () => {
  const { root, libraryId, config } = await setup()
  async function* chunks() { yield Buffer.from('first'); yield Buffer.from('second') }
  const stored = await storeSourceOriginal(config, root, libraryId, 'stream.md', chunks())
  const original = await readSourceOriginal(config, root, libraryId, stored.revision.revisionId)
  expect(Buffer.from(original.bytes).toString('utf8')).toBe('firstsecond')
})
it('recovers a durable intent whose original object was not yet linked', async () => {
  const { root, vault, libraryId, config } = await setup()
  const documentId = DocumentId('doc-prepublication'); const bytes = Buffer.from('before link')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const revision = `rev-${createHash('sha256').update(`${documentId}:${sha256}`).digest('hex').slice(0, 16)}`
  const dir = join(vault, '.octopus-kb', 'sources', revision)
  const staging = join(vault, '.octopus-kb', 'staging', 'interrupted')
  await mkdir(dir, { recursive: true }); await mkdir(staging, { recursive: true })
  await writeFile(join(staging, 'original'), bytes); const stagedPath = await realpath(join(staging, 'original'))
  await writeFile(join(dir, 'registration.json'), JSON.stringify({ command: 'register-source-revision', vault, documentId, libraryId, filename: 'recovered.md', sha256, byteLength: bytes.length, stagedPath }))
  await storeSourceOriginal(config, root, libraryId, 'next.md', Buffer.from('next'))
  expect(await readFile(join(dir, 'original'), 'utf8')).toBe('before link')
  await expect(stat(staging)).rejects.toMatchObject({ code: 'ENOENT' })
})
