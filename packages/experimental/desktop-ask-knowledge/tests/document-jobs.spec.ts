/**
 * Tests for durable document jobs, startup attempt fencing, and file-result protocol:
 * - Monotonic startup attempt fencing across restarts
 * - Stale job checkpoint rejection
 * - Interrupted job recovery and uncertain paid-work protection
 * - File-result protocol validation (path confinement, size limits, hash mismatch)
 * - Managed subprocess cancellation and timeout handling
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AskKnowledgeError, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { DocumentId, DocumentJobId } from '../src/document-types.ts'
import {
  cancelTrackedJob,
  createTrackedJob,
  finishTrackedJob,
  getLibraryStartupAttempt,
  getTrackedJob,
  initLibraryStartupAttempt,
  recoverLibraryJobs,
  runFileResultCommand,
  updateJobCheckpoint,
  validateFileResult,
} from '../src/document-jobs.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setupTestEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'ak-jobs-test-'))
  const sidecarHome = join(root, 'sidecar')
  const knowledgeHome = join(root, 'knowledge')
  const kbRoot = join(knowledgeHome, 'knowledge-bases')
  const libraryId = AskKnowledgeLibraryId('33333333-3333-3333-3333-333333333333')
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
          displayName: '任务管理测试库',
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

describe('document jobs and startup attempt fencing', () => {
  it('increments monotonic startup attempts and verifies active attempt', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const attempt1 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(attempt1).toBe(1)

    const current1 = await getLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(current1).toBe(1)

    // Second initialization (simulating companion restart)
    const attempt2 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(attempt2).toBe(2)

    const current2 = await getLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(current2).toBe(2)
  })

  it('rejects stale job checkpoints when startup attempt is superseded', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const attempt1 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(attempt1).toBe(1)

    const docId = DocumentId(`doc-${randomUUID()}`)

    // First register doc and rev so foreign keys pass
    const { storeSourceOriginal } = await import('../src/source-store.ts')
    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'test.md',
      new TextEncoder().encode('# Test'),
      docId,
    )

    const job = await createTrackedJob(
      config,
      knowledgeHome,
      libraryId,
      stored.document.id,
      stored.revision.revisionId,
      attempt1,
      'chunking',
      10,
      1000,
    )
    expect(job.status).toBe('active')

    // Valid checkpoint under attempt 1 succeeds
    await updateJobCheckpoint(
      config,
      knowledgeHome,
      libraryId,
      job.jobId,
      attempt1,
      3,
      3,
      300,
      JSON.stringify({ stage: 'chunking', lastChunk: 3 }),
    )

    const updated = await getTrackedJob(config, knowledgeHome, libraryId, job.jobId)
    expect(updated?.completedChunks).toBe(3)

    // Companion restarts -> attempt increments to 2
    const attempt2 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(attempt2).toBe(2)

    // Stale sidecar attempting to update checkpoint with old attempt 1 MUST be rejected
    await expect(
      updateJobCheckpoint(
        config,
        knowledgeHome,
        libraryId,
        job.jobId,
        attempt1, // Stale!
        4,
        4,
        400,
      ),
    ).rejects.toThrow(AskKnowledgeError)

    // Stale sidecar attempting to finish job with old attempt 1 MUST be rejected
    await expect(
      finishTrackedJob(
        config,
        knowledgeHome,
        libraryId,
        job.jobId,
        attempt1, // Stale!
        'completed',
      ),
    ).rejects.toThrow(AskKnowledgeError)
  })

  it('recovers interrupted jobs on restart and marks uncertain paid work visibly', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const attempt1 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    const docId = DocumentId(`doc-${randomUUID()}`)

    const { storeSourceOriginal } = await import('../src/source-store.ts')
    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'test2.md',
      new TextEncoder().encode('# Test 2'),
      docId,
    )

    const job = await createTrackedJob(
      config,
      knowledgeHome,
      libraryId,
      stored.document.id,
      stored.revision.revisionId,
      attempt1,
      'enriching',
      5,
      2500,
    )

    // Companion crashes/restarts -> attempt 2
    const attempt2 = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    expect(attempt2).toBe(2)

    // Recover jobs
    const recovered = await recoverLibraryJobs(config, knowledgeHome, libraryId, attempt2)
    const target = recovered.find(j => j.jobId === job.jobId)

    expect(target).toBeDefined()
    expect(target?.isUncertain).toBe(true)
    expect(target?.status).toBe('paused')
    expect(target?.error).toContain('interrupted by host restart')
  })

  it('cancels active job and marks it cancelled', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }

    const attempt = await initLibraryStartupAttempt(config, knowledgeHome, libraryId)
    const docId = DocumentId(`doc-${randomUUID()}`)

    const { storeSourceOriginal } = await import('../src/source-store.ts')
    const stored = await storeSourceOriginal(
      config,
      knowledgeHome,
      libraryId,
      'test3.md',
      new TextEncoder().encode('# Test 3'),
      docId,
    )

    const job = await createTrackedJob(
      config,
      knowledgeHome,
      libraryId,
      stored.document.id,
      stored.revision.revisionId,
      attempt,
      'converting',
    )

    await cancelTrackedJob(config, knowledgeHome, libraryId, job.jobId)

    const cancelled = await getTrackedJob(config, knowledgeHome, libraryId, job.jobId)
    expect(cancelled?.status).toBe('cancelled')
  })
})

describe('file-result protocol validation', () => {
  it('validates authentic file result payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ak-file-res-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })

    const resultPath = join(dir, 'result.json')
    const payload = { ok: true, passagesIndexed: 42, warnings: [] }
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8')
    await writeFile(resultPath, bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')

    const parsed = await validateFileResult(dir, resultPath, hash)
    expect(parsed.ok).toBe(true)
    expect(parsed.passagesIndexed).toBe(42)
  })

  it('rejects path escape attempts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ak-file-res-esc-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })

    await expect(
      validateFileResult(dir, join(dir, '..', 'escaped.json')),
    ).rejects.toThrow(AskKnowledgeError)
  })

  it('rejects oversized file results exceeding limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ak-file-res-size-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })

    const resultPath = join(dir, 'big.json')
    await writeFile(resultPath, Buffer.alloc(1024 * 1024)) // 1 MiB

    await expect(
      validateFileResult(dir, resultPath, undefined, 512 * 1024), // 512 KiB cap
    ).rejects.toThrow(AskKnowledgeError)
  })

  it('rejects file result with SHA-256 mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ak-file-res-hash-'))
    cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })

    const resultPath = join(dir, 'mismatch.json')
    await writeFile(resultPath, JSON.stringify({ ok: true }))

    await expect(
      validateFileResult(dir, resultPath, '0000000000000000000000000000000000000000000000000000000000000000'),
    ).rejects.toThrow(AskKnowledgeError)
  })

  it('executes one-shot command using file-result protocol and parses result', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }
    const jobId = DocumentJobId(`job-${randomUUID()}`)

    const res = await runFileResultCommand(
      config,
      knowledgeHome,
      libraryId,
      jobId,
      'runtime-check',
      {},
    )

    expect(res.ok).toBe(true)
    expect(res.sqlite_version).toBeDefined()
    expect(res.fts5).toBe(true)
    expect(res.trigram).toBe(true)
  })

  it('terminates command immediately when AbortSignal fires', async () => {
    const { sidecarHome, knowledgeHome, libraryId } = await setupTestEnvironment()
    const config = { sidecarRuntimePath: sidecarHome }
    const jobId = DocumentJobId(`job-${randomUUID()}`)
    const controller = new AbortController()

    const promise = runFileResultCommand(
      config,
      knowledgeHome,
      libraryId,
      jobId,
      'runtime-check',
      {},
      { signal: controller.signal },
    )

    controller.abort()
    await expect(promise).rejects.toThrow(AskKnowledgeError)
  })
})
