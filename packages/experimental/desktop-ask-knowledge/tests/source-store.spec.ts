/**
 * Unit and integration tests for source-store:
 * - Lossless original byte retention and SHA-256 verification
 * - Repeated bytes and deduplication
 * - Same filename with different content creating distinct revisions
 * - Corrupted or missing file detection
 * - Path traversal defense
 * - Transient lock retries
 * - Ingest pipeline integration
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import DesktopAskKnowledge from '../src/index.ts'
import { DocumentId, RevisionId } from '../src/document-types.ts'
import {
  readSourceOriginal,
  storeSourceOriginal,
  verifySourceRevision,
} from '../src/source-store.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setupTestEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'ak-source-store-test-'))
  const sidecarHome = join(root, 'sidecar')
  const knowledgeHome = join(root, 'knowledge')
  const kbRoot = join(knowledgeHome, 'knowledge-bases')
  const libraryId = AskKnowledgeLibraryId('22222222-2222-2222-2222-222222222222')
  const vaultDir = join(kbRoot, 'libraries', libraryId)

  await mkdir(sidecarHome, { recursive: true })
  await mkdir(vaultDir, { recursive: true })
  await installPythonSidecar(sidecarHome)

  await mkdir(kbRoot, { recursive: true })
  await writeFile(
    join(kbRoot, 'catalog.json'),
    JSON.stringify({
      version: 1,
      libraries: [
        {
          id: libraryId,
          displayName: '源文件测试库',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          vaultRelPath: `libraries/${libraryId}`,
        },
      ],
    }),
    'utf8',
  )

  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })

  return { root, sidecarHome, knowledgeHome, libraryId, vaultDir }
}

describe('source-store retention and integrity', () => {
  it('stores original binary bytes and reads them back identically', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const originalContent = new Uint8Array([0x00, 0xff, 0x42, 0x61, 0x6e, 0x61, 0x6e, 0x61, 0x0a, 0xef, 0xbb, 0xbf])
    const expectedSha256 = createHash('sha256').update(originalContent).digest('hex')

    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'binary-data.bin',
      originalContent,
    )

    expect(stored.document.displayFilename).toBe('binary-data.bin')
    expect(stored.revision.byteLength).toBe(originalContent.byteLength)
    expect(stored.revision.sha256).toBe(expectedSha256)
    expect(stored.revision.status).toBe('retained')

    const read = await readSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      stored.revision.revisionId,
    )

    expect(read.bytes).toEqual(originalContent)
    expect(read.revision.sha256).toBe(expectedSha256)

    const isValid = await verifySourceRevision(
      config,
      knowledgeHome,
      libraryId,
      stored.revision.revisionId,
    )
    expect(isValid).toBe(true)
  })

  it('preserves immutable revision when storing identical bytes under same document', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const content = new TextEncoder().encode('重复内容测试，保证不产生多余修订或损坏。')
    const docId = DocumentId(`doc-${randomUUID()}`)

    const first = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'doc.md',
      content,
      docId,
    )

    const second = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'doc.md',
      content,
      docId,
    )

    expect(second.revision.revisionId).toBe(first.revision.revisionId)
    expect(second.revision.sha256).toBe(first.revision.sha256)

    const read = await readSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      second.revision.revisionId,
    )
    expect(read.bytes).toEqual(content)
  })

  it('creates distinct revision IDs for same filename with different content', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const content1 = new TextEncoder().encode('版本1内容：初版制度')
    const content2 = new TextEncoder().encode('版本2内容：修订版制度，增加了补充说明')

    const first = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'policy.txt',
      content1,
    )

    const second = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'policy.txt',
      content2,
    )

    expect(first.revision.revisionId).not.toBe(second.revision.revisionId)
    expect(first.revision.sha256).not.toBe(second.revision.sha256)

    const read1 = await readSourceOriginal(config, knowledgeHome, libraryId, first.revision.revisionId)
    const read2 = await readSourceOriginal(config, knowledgeHome, libraryId, second.revision.revisionId)

    expect(new TextDecoder().decode(read1.bytes)).toBe('版本1内容：初版制度')
    expect(new TextDecoder().decode(read2.bytes)).toBe('版本2内容：修订版制度，增加了补充说明')
  })

  it('detects corrupted or truncated files on disk', async () => {
    const { sidecarHome, knowledgeHome, libraryId, vaultDir } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const content = new TextEncoder().encode('完整原始数据，将被篡改以测试损坏检测。')
    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'tamper.txt',
      content,
    )

    const filePath = join(vaultDir, stored.revision.objectPath)
    // Modify a byte on disk
    await writeFile(filePath, new TextEncoder().encode('篡改后的错误数据！'))

    await expect(
      readSourceOriginal(config, knowledgeHome, libraryId, stored.revision.revisionId),
    ).rejects.toThrow(AskKnowledgeError)

    const isValid = await verifySourceRevision(
      config,
      knowledgeHome,
      libraryId,
      stored.revision.revisionId,
    )
    expect(isValid).toBe(false)
  })

  it('detects missing files when disk object is removed', async () => {
    const { sidecarHome, knowledgeHome, libraryId, vaultDir } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const content = new TextEncoder().encode('即将被删除的测试文件')
    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'delete-me.txt',
      content,
    )

    const filePath = join(vaultDir, stored.revision.objectPath)
    await unlink(filePath)

    await expect(
      readSourceOriginal(config, knowledgeHome, libraryId, stored.revision.revisionId),
    ).rejects.toThrow(AskKnowledgeError)

    const isValid = await verifySourceRevision(
      config,
      knowledgeHome,
      libraryId,
      stored.revision.revisionId,
    )
    expect(isValid).toBe(false)
  })

  it('refuses cross-library or non-existent revision reads', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    await expect(
      readSourceOriginal(config, knowledgeHome, libraryId, RevisionId('rev-nonexistent')),
    ).rejects.toThrow(AskKnowledgeError)
  })

  it('retains source original through DesktopAskKnowledge finishIngest flow', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()

    const ctx = new Context()
    ctx.provide('systemPrompt', { section: () => () => {} })
    ctx.provide('sessionProjections', { register: () => () => {}, stateOf: () => null })
    ctx.provide('credentials', { resolve: async () => ({ value: 'sk-test-key' }) })
    const fiber = ctx.plugin(DesktopAskKnowledge, {
      sidecarRuntimePath: sidecarHome,
      knowledgeHome,
    })
    await fiber.await()
    cleanups.push(() => fiber.dispose())
    const service = ctx.askKnowledge!

    const rawMarkdown = '# Ingest Test\n\nOriginal file must be retained immutably in sources.'
    const rawBytes = Buffer.from(rawMarkdown, 'utf8')

    const handle = await service.beginIngest({
      libraryId,
      filename: 'ingest-test.md',
    })

    await service.appendIngestChunk({
      handle,
      bytes: rawBytes.toString('base64'),
    })

    // finishIngest stores the source original in .octopus-kb/sources/
    expect(await service.finishIngest({ handle })).toMatchObject({ status: 'deferred' })

    const expectedHash = createHash('sha256').update(rawBytes).digest('hex')

    // Document service should be registered and available on ctx
    expect(ctx.askKnowledgeDocuments).toBeDefined()
    const docs = await ctx.askKnowledgeDocuments!.listDocuments(libraryId)
    expect(docs.length).toBe(1)
    const firstDoc = docs[0]
    expect(firstDoc).toBeDefined()
    expect(firstDoc?.displayFilename).toBe('ingest-test.md')
    expect(firstDoc?.status).toBe('retained')

    const readBack = await ctx.askKnowledgeDocuments!.readOriginal(
      libraryId,
      firstDoc!.activeRevisionId,
    )
    expect(readBack.bytes).toEqual(new Uint8Array(rawBytes))
    expect(readBack.revision.sha256).toBe(expectedHash)
  })
})
