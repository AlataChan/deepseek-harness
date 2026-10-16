/**
 * Resumable document jobs, startup attempt fencing, and file-result execution.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/document-jobs
 */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import { JobId } from './document-types.ts'
import type { DocumentId, JobRecord, RevisionId } from './document-types.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { resolveSidecarHome } from './knowledge-home.ts'
import { withLibraryLock } from './library-lock.ts'
import { resolveKbRoot, resolveSidecarExecutable, runSidecar, withKnowledgeProcessRunner } from './sidecar.ts'

/** Maximum allowed file size for file-result protocol (50 MiB). */
export const MAX_FILE_RESULT_BYTES = 50 * 1024 * 1024

/**
 * Validate that targetPath does not escape baseDir.
 * @param baseDir - parent directory.
 * @param targetPath - candidate target.
 */
export function assertPathWithin(baseDir: string, targetPath: string): void {
  const resolvedBase = resolve(baseDir)
  const resolvedTarget = resolve(targetPath)
  const rel = relative(resolvedBase, resolvedTarget)
  if (rel.startsWith('..') || rel === '' || resolve(resolvedBase, rel) !== resolvedTarget) {
    throw new AskKnowledgeError('path-escape', `path ${targetPath} escapes directory ${baseDir}`)
  }
}

/**
 * Validate file result protocol output: path, bounds, sha256, and JSON structure.
 * @param allowedDir - allowed base directory for result.
 * @param resultPath - result file path.
 * @param expectedSha256 - optional SHA-256 hash.
 * @param maxBytes - maximum allowed bytes.
 * @returns parsed JSON object.
 */
export async function validateFileResult(
  allowedDir: string,
  resultPath: string,
  expectedSha256?: string,
  maxBytes = MAX_FILE_RESULT_BYTES,
): Promise<Record<string, unknown>> {
  assertPathWithin(allowedDir, resultPath)

  let lst
  try {
    lst = await lstat(resultPath)
  } catch {
    throw new AskKnowledgeError('ingest-failed', `result file missing at ${resultPath}`)
  }

  if (lst.isSymbolicLink()) {
    throw new AskKnowledgeError('path-escape', `symbolic links are forbidden: ${resultPath}`)
  }

  const realAllowed = await realpath(allowedDir)
  const realResult = await realpath(resultPath)
  assertPathWithin(realAllowed, realResult)

  const handle = await open(resultPath, constants.O_RDONLY | constants.O_NOFOLLOW)
  let content: Buffer
  try {
    const st = await handle.stat()
    if (!st.isFile() || st.dev !== lst.dev || st.ino !== lst.ino) {
      throw new AskKnowledgeError('path-escape', 'result file changed while opening')
    }
    if (st.size > maxBytes) {
      throw new AskKnowledgeError('file-too-large', `result file exceeds ${maxBytes} bytes`, { limit: maxBytes })
    }
    const chunks: Buffer[] = []
    let bytes = 0
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - bytes))
      const read = await handle.read(chunk, 0, chunk.length, null)
      if (read.bytesRead === 0) break
      bytes += read.bytesRead
      if (bytes > maxBytes) throw new AskKnowledgeError('file-too-large', `result file exceeds ${maxBytes} bytes`, { limit: maxBytes })
      chunks.push(chunk.subarray(0, read.bytesRead))
    }
    content = Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
  if (expectedSha256 !== undefined) {
    const actualHash = createHash('sha256').update(content).digest('hex')
    if (actualHash !== expectedSha256) {
      throw new AskKnowledgeError('ingest-failed', 'result file hash mismatch')
    }
  }

  try {
    const parsed = JSON.parse(content.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new AskKnowledgeError('ingest-failed', 'result JSON is not an object')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof AskKnowledgeError) throw err
    throw new AskKnowledgeError('ingest-failed', 'result file contains invalid JSON')
  }
}

/**
 * Initialize or increment the monotonic startup attempt for a library.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @returns monotonic startup attempt number.
 */
export async function initLibraryStartupAttempt(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<number> {
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'increment-startup-attempt',
      vault,
      libraryId,
    })
    return typeof res.startupAttempt === 'number' ? res.startupAttempt : 1
  })
}

/**
 * Read the active startup attempt for a library without incrementing.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @returns current startup attempt number.
 */
export async function getLibraryStartupAttempt(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<number> {
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'get-startup-attempt',
      vault,
      libraryId,
      increment: false,
    })
    return typeof res.startupAttempt === 'number' ? res.startupAttempt : 1
  })
}

/**
 * Create a new tracked job fenced to the active startup attempt.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param documentId - document id.
 * @param revisionId - source revision id.
 * @param startupAttempt - active startup attempt.
 * @param stage - initial stage.
 * @param totalChunks - estimated total chunks.
 * @param tokenEstimate - estimated total tokens.
 * @returns created job record.
 */
export async function createTrackedJob(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  documentId: DocumentId,
  revisionId: RevisionId,
  startupAttempt: number,
  stage = 'queued',
  totalChunks = 0,
  tokenEstimate = 0,
): Promise<JobRecord> {
  const jobId = JobId(`job-${randomUUID()}`)
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'create-job',
      vault,
      jobId,
      libraryId,
      documentId,
      revisionId,
      startupAttempt,
      stage,
      totalChunks,
      tokenEstimate,
    })
    if (res.ok !== true) {
      throw new AskKnowledgeError('ingest-failed', String(res.error ?? 'failed to create job'))
    }
    const job: JobRecord = {
      jobId,
      libraryId,
      documentId,
      revisionId,
      startupAttempt,
      stage,
      status: 'active',
      totalChunks,
      completedChunks: 0,
      currentChunkIndex: 0,
      tokenEstimate,
      tokensUsed: 0,
      isUncertain: false,
      createdAt: typeof res.createdAt === 'string' ? res.createdAt : new Date().toISOString(),
      updatedAt: typeof res.updatedAt === 'string' ? res.updatedAt : new Date().toISOString(),
    }
    return job
  })
}

/**
 * Update job progress under startup attempt fencing.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job id.
 * @param expectedStartupAttempt - fenced startup attempt.
 * @param completedChunks - count of completed chunks.
 * @param currentChunkIndex - next chunk index.
 * @param tokensUsed - tokens spent so far.
 * @param checkpointJson - serialized resumable state.
 * @param stage - current stage.
 */
export async function updateJobCheckpoint(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
  expectedStartupAttempt: number,
  completedChunks: number,
  currentChunkIndex: number,
  tokensUsed: number,
  checkpointJson?: string,
  stage?: string,
): Promise<void> {
  await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'update-job-checkpoint',
      vault,
      jobId,
      expectedStartupAttempt,
      completedChunks,
      currentChunkIndex,
      tokensUsed,
      ...checkpointJson !== undefined ? { checkpointJson } : {},
      ...stage !== undefined ? { stage } : {},
    })
    if (res.ok !== true) {
      throw new AskKnowledgeError('ingest-failed', String(res.error ?? 'failed to update checkpoint'))
    }
  })
}

/**
 * Mark a job finished under startup attempt fencing.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job id.
 * @param expectedStartupAttempt - fenced startup attempt.
 * @param status - final status.
 * @param error - optional failure reason.
 */
export async function finishTrackedJob(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
  expectedStartupAttempt: number,
  status: 'completed' | 'failed' = 'completed',
  error?: string,
): Promise<void> {
  await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'finish-job',
      vault,
      jobId,
      expectedStartupAttempt,
      status,
      ...error !== undefined ? { error } : {},
    })
    if (res.ok !== true) {
      throw new AskKnowledgeError('ingest-failed', String(res.error ?? 'failed to finish job'))
    }
  })
}

/**
 * Mark a job uncertain so paid calls are never silently repeated.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job id.
 * @param reason - uncertainty description.
 */
export async function markJobUncertain(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
  reason: string,
): Promise<void> {
  await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    await runSidecar(config, {
      command: 'mark-job-uncertain',
      vault,
      jobId,
      reason,
    })
  })
}

/**
 * Cancel a job and terminate any active child process immediately.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job id to cancel.
 */
export async function cancelTrackedJob(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
): Promise<void> {
  await config.processRunner?.cancelJob(jobId)

  await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    await runSidecar(config, {
      command: 'cancel-job',
      vault,
      jobId,
    })
  })
}

/**
 * Retrieve one job record by ID.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job id.
 * @returns job record or null.
 */
export async function getTrackedJob(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
): Promise<JobRecord | null> {
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'get-job',
      vault,
      jobId,
    })
    return (res.job as JobRecord | null) ?? null
  })
}

/**
 * List all jobs in one library.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @returns array of job records.
 */
export async function listTrackedJobs(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
): Promise<JobRecord[]> {
  return await withLibraryLock(libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    const res = await runSidecar(config, {
      command: 'list-jobs',
      vault,
      libraryId,
    })
    return (Array.isArray(res.jobs) ? res.jobs : []) as JobRecord[]
  })
}

/**
 * Run one owned sidecar command with file-result protocol, timeout, and cancellation.
 * @param config - home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param jobId - job identifier.
 * @param command - sidecar command name.
 * @param payload - command payload.
 * @param options - execution options.
 * @returns parsed validated file result.
 */
export async function runFileResultCommand(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  jobId: JobId,
  command: string,
  payload: Record<string, unknown>,
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
  } = {},
): Promise<Record<string, unknown>> {
  if (options.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'conversion was aborted')

  const row = await requireLibrary(knowledgeHome, libraryId)
  const vault = await assertVaultDir(knowledgeHome, row)

  const jobsRoot = join(vault, '.octopus-kb', 'jobs')
  await mkdir(jobsRoot, { recursive: true, mode: 0o700 })
  const jobDir = await mkdtemp(join(jobsRoot, 'run-'))
  const resultPath = join(jobDir, 'result.json')

  const home = resolveSidecarHome(config)
  const executable = resolveSidecarExecutable(home)
  const kbRoot = resolveKbRoot(home)

  try {
    return await withKnowledgeProcessRunner(config, async (runner) => {
      const result = await runner.run({
        argv: [executable],
        cwd: home,
        input: `${JSON.stringify({ command, vault, jobId, resultPath, ...payload })}\n`,
        env: { OCTOPUS_KB_ROOT: kbRoot, ...options.env },
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        jobId,
      })
      const parsed: unknown = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '')
      if (typeof parsed !== 'object' || parsed === null) {
        throw new AskKnowledgeError('ingest-failed', 'invalid file-result envelope')
      }
      if ('protocol' in parsed && parsed.protocol === 'file-result-v1' &&
          'resultPath' in parsed && typeof parsed.resultPath === 'string' &&
          'sha256' in parsed && typeof parsed.sha256 === 'string') {
        return await validateFileResult(jobDir, parsed.resultPath, parsed.sha256)
      }
      throw new AskKnowledgeError('ingest-failed', 'sidecar did not produce file-result-v1')
    })
  } finally {
    await rm(jobDir, { recursive: true, force: true })
  }
}

/**
 * Recover jobs across restart. Fences any jobs belonging to an older attempt,
 * marking in-flight paid work as uncertain.
 * @param config - sidecar home config.
 * @param knowledgeHome - app data directory.
 * @param libraryId - catalog id.
 * @param currentStartupAttempt - active startup attempt.
 * @returns recovered active or paused jobs.
 */
export async function recoverLibraryJobs(
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  currentStartupAttempt: number,
): Promise<JobRecord[]> {
  const jobs = await listTrackedJobs(config, knowledgeHome, libraryId)
  const recovered: JobRecord[] = []

  for (const job of jobs) {
    if (job.status === 'active' && job.startupAttempt < currentStartupAttempt) {
      const reason = `interrupted by host restart (attempt ${job.startupAttempt} < ${currentStartupAttempt})`
      await markJobUncertain(
        config,
        knowledgeHome,
        libraryId,
        job.jobId,
        reason,
      )
      recovered.push({ ...job, isUncertain: true, status: 'paused', error: reason })
    } else {
      recovered.push(job)
    }
  }

  return recovered
}
