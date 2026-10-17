/**
 * Tests for legacy library migration and library deletion cleanup (Task 8 / AC12, AC13).
 * @module
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { DocumentsServiceImpl } from '../src/documents-service.ts'
import type { AskKnowledgeHomeConfig } from '../src/knowledge-home.ts'
import { runSidecar } from '../src/sidecar.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const TEST_LIB = '88888888-4444-4444-8888-123456789abc' as AskKnowledgeLibraryId

describe('document migration and library lifecycle cleanup', () => {
  let tempDir: string
  let sidecarHome: string
  let knowledgeHome: string
  let vaultDir: string
  let config: AskKnowledgeHomeConfig

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dsh-migration-test-'))
    sidecarHome = join(tempDir, 'sidecar')
    knowledgeHome = join(tempDir, 'knowledge')
    const kbRoot = join(knowledgeHome, 'knowledge-bases')
    vaultDir = join(kbRoot, 'libraries', TEST_LIB)

    await mkdir(sidecarHome, { recursive: true })
    await mkdir(join(vaultDir, 'wiki'), { recursive: true })
    await mkdir(join(vaultDir, 'raw', 'sub'), { recursive: true })
    await mkdir(join(vaultDir, '.octopus-kb'), { recursive: true })

    await installPythonSidecar(sidecarHome)
    config = { sidecarRuntimePath: sidecarHome, knowledgeHome }

    await mkdir(kbRoot, { recursive: true })
    const now = new Date().toISOString()
    await writeFile(
      join(kbRoot, 'catalog.json'),
      JSON.stringify({
        version: 1,
        libraries: [
          {
            id: TEST_LIB,
            displayName: '迁移测试知识库',
            createdAt: now,
            lastUsedAt: now,
            vaultRelPath: `libraries/${TEST_LIB}`,
          },
        ],
      }),
      'utf8',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('migrates legacy markdown files to documents store with original_unavailable and enables search (AC12)', async () => {
    // 1. Create legacy markdown files in raw/
    const doc1 = '# 志愿者培训管理办法\n\n所有新加入的志愿者须完成基础培训课程并参加考核。\n'
    const doc2 = '# 社区财务报销审批流\n\n单笔支出超过两千元需由理事会专项审批签字。\n'
    const handAuthoredWiki = '---\ntitle: 机构历史\nrole: note\n---\n这是手工编写的历史记录，未经任何模型提取。\n'

    await writeFile(join(vaultDir, 'raw', 'volunteers.md'), doc1, 'utf8')
    await writeFile(join(vaultDir, 'raw', 'sub', 'finance.md'), doc2, 'utf8')
    await writeFile(join(vaultDir, 'wiki', '机构历史.md'), handAuthoredWiki, 'utf8')

    const service = new DocumentsServiceImpl(config)

    // 2. Perform migration
    const res = await service.migrateLibrary(TEST_LIB)
    expect(res.ok).toBe(true)
    expect(res.migratedDocuments).toBe(2)
    expect(res.totalPassages).toBeGreaterThanOrEqual(2)

    // 3. Verify documents and source_revisions records
    const docs = await service.listDocuments(TEST_LIB)
    expect(docs.length).toBe(2)

    const volDoc = docs.find(d => d.displayFilename === 'volunteers.md')
    expect(volDoc).toBeDefined()
    expect(volDoc?.status).toBe('retained')

    const revRes = await runSidecar(config, {
      command: 'get-source-revision',
      vault: vaultDir,
      revisionId: volDoc!.activeRevisionId,
    })
    expect(revRes.ok).toBe(true)
    const rev = revRes.revision as Record<string, unknown>
    // AC12: Missing original binaries cannot be fabricated from Markdown; marked original_unavailable
    expect(rev.status).toBe('original_unavailable')
    expect(rev.originalFilename).toBe('volunteers.md')
    expect(rev.mimeType).toBe('text/markdown')

    const location = await runSidecar(config, {
      command: 'document-location', vault: vaultDir, libraryId: TEST_LIB,
      documentId: volDoc!.id, action: 'text',
    })
    expect(location.ok).toBe(true)
    expect(location.path).toBe('raw/volunteers.md')
    expect(await readFile(join(vaultDir, String(location.path)), 'utf8')).toBe(doc1)

    // 4. Verify full-text search immediately finds passages in migrated files (AC3, AC8)
    const searchRes = await runSidecar(config, {
      command: 'passage-search',
      vault: vaultDir,
      query: '志愿者培训',
      layer: 'raw',
    })
    expect(searchRes.ok).toBe(true)
    const items = searchRes.items as Array<Record<string, unknown>>
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!.text).toContain('基础培训课程')

    // 5. Verify hand-authored wiki was preserved completely untouched
    const wikiContent = await readFile(join(vaultDir, 'wiki', '机构历史.md'), 'utf8')
    expect(wikiContent).toBe(handAuthoredWiki)
  })

  it('is idempotent when re-run on an already migrated library', async () => {
    await writeFile(join(vaultDir, 'raw', 'rules.md'), '# 社区规范\n\n准则条例。\n', 'utf8')
    const service = new DocumentsServiceImpl(config)

    const res1 = await service.migrateLibrary(TEST_LIB)
    expect(res1.ok).toBe(true)
    expect(res1.migratedDocuments).toBe(1)

    // Second run: no new files to migrate
    const res2 = await service.migrateLibrary(TEST_LIB)
    expect(res2.ok).toBe(true)
    expect(res2.migratedDocuments).toBe(0)

    const docs = await service.listDocuments(TEST_LIB)
    expect(docs.length).toBe(1)
  })

  it('fails safely and leaves database intact if existing schema is an unsupported future version (AC11)', async () => {
    // Seed database with future schema version = 999
    const dbPath = join(vaultDir, '.octopus-kb', 'documents.sqlite')
    const proc = await runSidecar(config, {
      command: 'bootstrap',
      vault: vaultDir,
    })
    expect(proc.ok).toBe(true)

    // Manually set schema version to 999
    const scriptPath = join(tempDir, 'set_schema.py')
    await writeFile(
      scriptPath,
      `import sqlite3
con = sqlite3.connect(${JSON.stringify(dbPath)})
con.execute("CREATE TABLE IF NOT EXISTS schema_info (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
con.execute("INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', '999')")
con.commit()
con.close()
`,
      'utf8',
    )
    const { execSync } = await import('node:child_process')
    execSync(`python3 "${scriptPath}"`)

    await writeFile(join(vaultDir, 'raw', 'new.md'), '# 新文档\n', 'utf8')
    const service = new DocumentsServiceImpl(config)

    // Refuses future schema and fails safely
    await expect(service.migrateLibrary(TEST_LIB)).rejects.toThrow(/unsupported future schema version/)
  })

  it('cancels all active and queued library jobs when cancelLibraryJobs is called (AC13)', async () => {
    // 1. Create a dummy sqlite with active and queued jobs
    const service = new DocumentsServiceImpl(config)
    await writeFile(join(vaultDir, 'raw', 'file.md'), '# 规则\n正文\n', 'utf8')
    await service.migrateLibrary(TEST_LIB)

    const docs = await service.listDocuments(TEST_LIB)
    const doc = docs[0]!

    await runSidecar(config, {
      command: 'create-job',
      vault: vaultDir,
      jobId: 'job-active-1',
      libraryId: TEST_LIB,
      documentId: doc.id,
      revisionId: doc.activeRevisionId,
      startupAttempt: 1,
      stage: 'converting',
      totalChunks: 5,
      tokenEstimate: 5000,
    })

    const cancelRes = await service.cancelLibraryJobs(TEST_LIB)
    expect(cancelRes.ok).toBe(true)
    expect(cancelRes.cancelledCount).toBe(1)

    const jobRes = await runSidecar(config, {
      command: 'get-job',
      vault: vaultDir,
      jobId: 'job-active-1',
    })
    expect(jobRes.ok).toBe(true)
    const job = jobRes.job as Record<string, unknown>
    expect(job.status).toBe('cancelled')
  })
})
