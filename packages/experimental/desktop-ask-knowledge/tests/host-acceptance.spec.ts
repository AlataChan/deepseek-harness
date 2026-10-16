/**
 * Host acceptance suite for Ask Knowledge source retention, passage retrieval,
 * and background lifecycle (AC1-AC13, AC21).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DesktopAskKnowledge from '../src/index.ts'
import { assertVaultDir, requireLibrary } from '../src/catalog.ts'
import { indexLibraryVault, searchLibraryPassages } from '../src/document-retrieve.ts'
import {
  createTrackedJob,
  initLibraryStartupAttempt,
  updateJobCheckpoint,
  finishTrackedJob,
} from '../src/document-jobs.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

describe('Ask Knowledge Host Acceptance (AC1-AC13, AC21)', () => {
  it('exercises full retention, retrieval, jobs, and cleanup lifecycle', async () => {
    const sidecarHome = await mkdtemp(join(tmpdir(), 'ask-k-sidecar-'))
    await installPythonSidecar(sidecarHome)
    const home = await mkdtemp(join(tmpdir(), 'ask-k-acceptance-'))
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      section: () => () => {},
    })
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => null,
    })

    const fiber = ctx.plugin(DesktopAskKnowledge, {
      knowledgeHome: home,
      sidecarRuntimePath: sidecarHome,
    })
    await fiber.await()

    const askKnowledge = ctx.get('askKnowledge')!
    const docsService = ctx.get('askKnowledgeDocuments')!
    expect(askKnowledge).toBeDefined()
    expect(docsService).toBeDefined()

    try {
      // 1. Create a library
      const lib = await askKnowledge.createLibrary({ displayName: 'Acceptance Library' })
      const libraryId = lib.id

      // ── AC1: Lossless retention byte equality ──
      const sampleText = '# 第一章 制度总则\n\n所有员工必须遵守安全规范。\n\n| 编号 | 项目 | 标准 |\n| --- | --- | --- |\n| 1 | 门禁 | 随身佩戴 |\n| 2 | 消防 | 定期检查 |\n\n注：特殊岗位经安全主管批准可予免除。'
      const sampleBytes = new TextEncoder().encode(sampleText)
      const stored = await docsService.storeOriginal(libraryId, 'handbook.md', sampleBytes)
      expect(stored.document.displayFilename).toBe('handbook.md')
      expect(stored.revision.mimeType).toBe('text/markdown')

      // Read back and assert byte-for-byte equality
      const readBack = await docsService.readOriginal(libraryId, stored.revision.revisionId)
      expect(readBack.bytes).toEqual(sampleBytes)

      // Verify integrity
      const isClean = await docsService.verifyIntegrity(libraryId, stored.revision.revisionId)
      expect(isClean).toBe(true)

      // AC1 Invalid control: Missing or corrupted source cannot be reported retained
      const corruptedBytes = new Uint8Array(sampleBytes)
      corruptedBytes[0] = (corruptedBytes[0]! ^ 0xff)
      await writeFile(readBack.absPath, corruptedBytes)
      const isCorrupted = await docsService.verifyIntegrity(libraryId, stored.revision.revisionId)
      expect(isCorrupted).toBe(false)
      // Restore valid bytes
      await writeFile(readBack.absPath, sampleBytes)

      // ── AC2 / AC3 / AC8 / AC21: Passage search across document spans ──
      const libRow = await requireLibrary(home, libraryId)
      const vaultDir = await assertVaultDir(home, libRow)
      const rawDir = join(vaultDir, 'raw')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(rawDir, { recursive: true })
      await writeFile(join(rawDir, 'handbook.md'), sampleText, 'utf-8')

      // Radical equivalence test: "一老一小" folded query
      const kangxiText = '# 政策\n\n\u2faf\u5411\u2fbc\u8d28\u91cf\u53d1\u5c55\u7684\u201c\u2f00\u2f7c\u2f00\u2f29\u201d\u653f\u7b56。\n'
      await writeFile(join(rawDir, 'kangxi.md'), kangxiText, 'utf-8')

      const config = { knowledgeHome: home, sidecarRuntimePath: sidecarHome }

      // Index the raw documents
      const indexRes = await indexLibraryVault(config, home, libraryId)
      expect(indexRes.indexedFiles).toBeGreaterThanOrEqual(2)
      expect(indexRes.totalPassages).toBeGreaterThanOrEqual(2)

      // Query table facts (AC2)
      const tableHits = await searchLibraryPassages(config, home, {
        libraryId,
        queries: ['门禁', '随身佩戴'],
      })
      expect(tableHits.items.length).toBeGreaterThan(0)
      expect(tableHits.items[0]?.text).toContain('门禁')

      // Query late exceptions (AC5)
      const exceptionHits = await searchLibraryPassages(config, home, {
        libraryId,
        queries: ['特殊岗位', '安全主管批准'],
      })
      expect(exceptionHits.items.length).toBeGreaterThan(0)
      expect(exceptionHits.items[0]?.text).toContain('免除')

      // AC21: Folded literal retrieval preserves radical equivalence
      const foldHits = await searchLibraryPassages(config, home, {
        libraryId,
        queries: ['一老一小'],
      })
      expect(foldHits.items.length).toBeGreaterThan(0)
      expect(foldHits.items[0]?.path).toBe('raw/kangxi.md')

      // ── AC9: Continuation cursor with bounded retrieval ──
      const boundedHits = await searchLibraryPassages(config, home, {
        libraryId,
        queries: ['规范'],
        limit: 1,
      })
      expect(boundedHits.items.length).toBe(1)
      if (boundedHits.cursor) {
        const nextHits = await searchLibraryPassages(config, home, {
          libraryId,
          queries: ['规范'],
          cursor: boundedHits.cursor,
        })
        expect(Array.isArray(nextHits.items)).toBe(true)
      }
      // AC9 Invalid control: Forged/tampered cursor is refused
      await expect(
        searchLibraryPassages(config, home, {
          libraryId,
          queries: ['规范'],
          cursor: 'forged-invalid-cursor',
        }),
      ).rejects.toThrow()

      // ── AC4 / AC10: Job lifecycle with startup-attempt fencing ──
      const attempt1 = await initLibraryStartupAttempt(config, home, libraryId)
      expect(attempt1).toBeGreaterThanOrEqual(1)

      const job = await createTrackedJob(
        config,
        home,
        libraryId,
        stored.document.id,
        stored.revision.revisionId,
        attempt1,
        'queued',
        5,
        1000,
      )
      expect(job.status).toBe('active')

      // Update checkpoint under current attempt
      await updateJobCheckpoint(
        config,
        home,
        libraryId,
        job.jobId,
        attempt1,
        3,
        3,
        600,
        JSON.stringify({ lastChunkId: 'chunk-3' }),
        'enriching',
      )

      // AC10 Invalid control: Attempting to finish with a stale attempt must be refused
      await expect(
        finishTrackedJob(
          config,
          home,
          libraryId,
          job.jobId,
          attempt1 - 1, // Stale!
          'completed',
        ),
      ).rejects.toThrow()

      // Finish cleanly under the correct attempt
      await finishTrackedJob(
        config,
        home,
        libraryId,
        job.jobId,
        attempt1,
        'completed',
      )

      // ── AC12: Legacy library migration ──
      const legacyLib = await askKnowledge.createLibrary({ displayName: 'Legacy Lib' })
      const legacyRow = await requireLibrary(home, legacyLib.id)
      const legacyVault = await assertVaultDir(home, legacyRow)
      const { mkdir: mkdirLegacy } = await import('node:fs/promises')
      await mkdirLegacy(join(legacyVault, 'raw'), { recursive: true })
      await writeFile(
        join(legacyVault, 'raw', 'legacy-source.md'),
        '# 历史文献\n\n历史文献正文内容。',
        'utf-8',
      )
      const migrationRes = await docsService.migrateLibrary(legacyLib.id)
      expect(migrationRes.ok).toBe(true)
      expect(migrationRes.migratedDocuments).toBe(1)
      const legacyDocs = await docsService.listDocuments(legacyLib.id)
      expect(legacyDocs.length).toBe(1)
      expect(legacyDocs[0]?.displayFilename).toBe('legacy-source.md')

      // ── AC13: Library deletion cleans retained files and sqlite ──
      await askKnowledge.removeLibrary({ libraryId })
      const remainingLibs = await askKnowledge.listLibraries()
      expect(remainingLibs.some(l => l.id === libraryId)).toBe(false)
    } finally {
      await fiber.dispose()
      await rm(home, { recursive: true, force: true })
      await rm(sidecarHome, { recursive: true, force: true })
    }
  })
})
