/**
 * octopus_DSH desktop ask-knowledge Provider: `ctx.askKnowledge` over a
 * system-directory catalog plus a Python sidecar.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AskKnowledge, AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { askKnowledgeBindingProjectionDefinition } from '@deepseek-ai/dsh-host-ask-knowledge'
import type {
  AskKnowledgeAttachLease, AskKnowledgeBundle, AskKnowledgeExtractResult, AskKnowledgeIngestHandle,
  AskKnowledgeIngestResult, AskKnowledgeLibrary, AskKnowledgeLibraryId, AskKnowledgeLookup,
  AskKnowledgeStatus,
} from '@deepseek-ai/dsh-host-ask-knowledge'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import {
  createCatalogLibrary, listCatalog, readCatalog, renameCatalogLibrary, requireLibrary,
  resumeDeleting, touchLastUsed, writeCatalog, catalogPath, assertVaultDir, isNotFound,
} from './catalog.ts'
import { CATALOG_VERSION } from './catalog.ts'
import { resolveKnowledgeHome, type AskKnowledgeHomeConfig } from './knowledge-home.ts'
import {
  withCatalogLock, withLibraryLock, withSessionLock, withSessionLocks,
} from './library-lock.ts'
import { renderAskKnowledgeRetrievePrompt } from './prompt-retrieve.ts'
import { healRejectedProposals, pendingAuditCount, recoverPendingAudits } from './ingest.ts'
import { lookupLibraryTerm, retrieveLibraryBundle } from './retrieve.ts'
import { resolveResultBounds, type ResultBounds } from './result-bounds.ts'
import { placeLibraryShortcut, revealLibraryVault } from './shortcut.ts'
import { registerAskKnowledgeTools } from './tools.ts'
import { listBoundSessionIds, unbindSession } from './unbind.ts'
import { convertUploadToText } from './extract.ts'
import { isDocxExtractFilename } from './extract-docx.ts'
import {
  appendUpload, beginExtractUpload, beginUpload, decodeIngestChunk, DEFAULT_MAX_INGEST_BYTES,
  disposeUpload, materializeUpload, type IngestUpload,
} from './upload-temp.ts'
import { resolveSidecarHome } from './knowledge-home.ts'
import { runSidecar, KnowledgeProcessRunner, setKnowledgeProcessRunner } from './sidecar.ts'
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DocumentView, DocumentActionRequest, DocumentLibraryId } from './document-view.ts'
import { RevisionId } from './document-types.ts'
import { resolveProposeEnv } from './credentials-bridge.ts'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import { searchLibraryPassages, readLibraryPassage } from './document-retrieve.ts'
import { mkdir, readFile, readdir, rm, realpath, lstat, open, link, unlink } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { convertSourceFile, type ConversionResult } from './conversion.ts'
import {
  DocumentsServiceImpl,
  registerDocumentsService,
  type AskKnowledgeDocumentsService,
} from './documents-service.ts'
import {
  readSourceOriginal,
  recoverSourceRegistrations,
  storeSourceOriginal,
  verifySourceRevision,
} from './source-store.ts'
import {
  initLibraryStartupAttempt,
  createTrackedJob,
  getLibraryStartupAttempt,
  recoverLibraryJobs,
} from './document-jobs.ts'
import { indexLibraryVault } from './document-retrieve.ts'
export * from './document-types.ts'
export type { DocumentView, DocumentActionRequest, DocumentLibraryId } from './document-view.ts'
export {
  DocumentsServiceImpl,
  registerDocumentsService,
  type AskKnowledgeDocumentsService,
  readSourceOriginal,
  storeSourceOriginal,
  verifySourceRevision,
}
export {
  initLibraryStartupAttempt,
  createTrackedJob,
  updateJobCheckpoint,
  finishTrackedJob,
  markJobUncertain,
  cancelTrackedJob,
  getTrackedJob,
  listTrackedJobs,
  validateFileResult,
  runFileResultCommand,
  recoverLibraryJobs,
  MAX_FILE_RESULT_BYTES,
} from './document-jobs.ts'
export { MISSING_API_KEY_MESSAGE, resolveProposeEnv } from './credentials-bridge.ts'
export { runSidecar, resolveSidecarExecutable, packagePythonDir } from './sidecar.ts'
export { boundRetrieveResult, resolveResultBounds, tokenEstimate, clipItemText } from './result-bounds.ts'
export { parseAskKnowledgeTerms, parseAskKnowledgeLookupTerm } from '@deepseek-ai/dsh-host-ask-knowledge'
export { withSessionLock, withLibraryLock, withCatalogLock, withSessionLocks } from './library-lock.ts'
export { renderAskKnowledgeRetrievePrompt } from './prompt-retrieve.ts'
export {
  searchLibraryPassages,
  indexLibraryVault,
  checkSqliteRuntime,
  type PassageSearchItem,
  type PassageSearchResult,
  type PassageSearchRequest,
} from './document-retrieve.ts'

/** Validated plugin configuration. */
export interface Config extends AskKnowledgeHomeConfig {
  /** Maximum source characters included in one extraction request. */
  readonly extractionChunkChars?: number
  /** Maximum existing-library context characters included in each extraction request. */
  readonly extractionContextChars?: number
  /** Deadline in milliseconds for an explicitly approved extraction job. */
  readonly extractionTimeoutMs?: number
  /** Reserved maximum output tokens per extraction request. */
  readonly extractionOutputTokens?: number
  /** Maximum accepted source file size in bytes. */
  readonly maxIngestBytes?: number
  /** Maximum retrieve items kept in the full tool result. */
  readonly maxResultItems?: number
  /** Maximum retrieve characters kept in the full tool result. */
  readonly maxResultChars?: number
  /** Maximum retrieve tokens kept in the full tool result. */
  readonly maxResultTokens?: number
}

/** The `ctx.askKnowledge` desktop implementation. */
export default class DesktopAskKnowledge extends AskKnowledge {
  static inject = ['sessionProjections', 'systemPrompt']

  /**
   * Optional overrides for the system knowledge home and sidecar runtime.
   * Empty strings fall through to `OCTOPUS_APP_DATA` / `OCTOPUS_SIDECAR_HOME`.
   */
  static Config: z<Config> = z.object({
    knowledgeHome: z.string().default(''),
    sidecarRuntimePath: z.string().default(''),
    extractionChunkChars: z.number().step(1).min(128).max(8000).default(1500),
    extractionContextChars: z.number().step(1).min(0).max(8000).default(2000),
    extractionTimeoutMs: z.number().step(1).min(1000).max(3600000).default(1800000),
    extractionOutputTokens: z.number().step(1).min(128).max(8192).default(2048),
    maxIngestBytes: z.natural().default(DEFAULT_MAX_INGEST_BYTES),
    maxResultItems: z.natural().default(12),
    maxResultChars: z.natural().default(24_000),
    maxResultTokens: z.natural().default(6000),
  })

  /** Generated Gateway binding for desktop document operations. */
  readonly typertRemote = bindTypertRemote(this, 'askKnowledge')
  private readonly ready: Promise<void>
  private readonly lifetime = new AbortController()
  private readonly documentRuns = new Map<string, { controller: AbortController; done: Promise<unknown> }>()
  private readonly config: Config
  private readonly uploads = new Map<string, IngestUpload>()
  private readonly bounds: ResultBounds

  /**
   * @param ctx - Host context that registers this service.
   * @param config - validated knowledge-home override.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    const runner = new KnowledgeProcessRunner(ctx.get('subprocess'))
    this.config = { ...config }
    setKnowledgeProcessRunner(this.config, runner)
    this.bounds = resolveResultBounds({
      maxItems: config.maxResultItems,
      maxChars: config.maxResultChars,
      maxTokens: config.maxResultTokens,
    })
    ctx.effect(
      () => ctx.sessionProjections.register(askKnowledgeBindingProjectionDefinition),
      'desktop-ask-knowledge.projection',
    )
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'ask-knowledge:retrieve',
      order: 91,
      text: (context) => {
        const session = context.agent?.session
        if (session === undefined) return ''
        const binding = ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')
        if (binding == null) return ''
        if (sessionPreset(ctx, session) === 'data-agent') return ''
        return renderAskKnowledgeRetrievePrompt()
      },
    }), 'desktop-ask-knowledge.prompt')
    if (ctx.get('tools') !== undefined) {
      ctx.effect(() => registerAskKnowledgeTools(ctx, {
        search: (request, signal) => searchLibraryPassages(this.config, this.home(), request, signal),
        read: (request, signal) => readLibraryPassage(this.config, this.home(), request, signal),
      }), 'desktop-ask-knowledge.tools')
    }
    ctx.effect(
      () => registerDocumentsService(ctx, this.config),
      'desktop-ask-knowledge.documents-service',
    )
    this.ready = this.initialize()
    // Preserve the failure for callers while observing it until first use.
    void this.ready.catch(error => ctx.logger('ask-knowledge').warn(error))
    ctx.effect(() => async () => {
      this.lifetime.abort()
      for (const run of this.documentRuns.values()) run.controller.abort()
      await Promise.allSettled([...this.documentRuns.values()].map(run => run.done))
      await runner.dispose()
      await this.ready.catch(error => ctx.logger('ask-knowledge').warn(error))
      await Promise.all([...this.uploads.values()].map(disposeUpload))
    })
  }

  /**
   * Hold the overlay session mutex. Prompt and retrieve wrap this so remove
   * cannot take the library lock during an in-flight turn.
   * @param sessionId - Session identity.
   * @param fn - exclusive work.
   * @returns the work result.
   */
  withSessionLock<T>(sessionId: SessionId, fn: () => Promise<T>): Promise<T> {
    return withSessionLock(sessionId, fn)
  }

  /**
   * List catalog rows. Does not run recover.
   * @param signal - caller lifetime.
   * @returns catalog rows.
   */
  override async listLibraries(signal?: AbortSignal): Promise<AskKnowledgeLibrary[]> {
    signal?.throwIfAborted()
    return listCatalog(this.home())
  }

  /**
   * List ingested raw documents for a vault.
   * @param request - library identity.
   * @param signal - caller lifetime.
   * @returns document file paths (e.g., `raw/sample.md`).
   */
  override async listLibraryDocuments(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    signal?.throwIfAborted()
    const home = this.home()
    const row = await requireLibrary(home, request.libraryId)
    const vault = await assertVaultDir(home, row)
    let entries: string[]
    try {
      entries = await readdir(join(vault, 'raw'), { recursive: true })
    } catch (error: unknown) {
      /* v8 ignore next -- a vault without raw/ is an empty document set */
      if (isNotFound(error)) return []
      throw error
    }
    return entries.filter(entry => entry.toLowerCase().endsWith('.md')).sort()
  }

  /**
   * Create an empty vault and catalog row.
   * @param request - display name.
   * @param signal - caller lifetime.
   * @returns the new row.
   */
  override async createLibrary(
    request: { displayName: string; workspaceId?: WorkspaceId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary> {
    signal?.throwIfAborted()
    const created = await createCatalogLibrary(this.home(), request.displayName)
    if (request.workspaceId !== undefined) {
      await placeLibraryShortcut(this.ctx, this.home(), created.id, request.workspaceId)
    }
    return created
  }

  /**
   * Rename a catalog row.
   * @param request - library id and new name.
   * @param signal - caller lifetime.
   * @returns the updated row.
   */
  override async renameLibrary(
    request: { libraryId: AskKnowledgeLibraryId; displayName: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary> {
    signal?.throwIfAborted()
    return renameCatalogLibrary(this.home(), request.libraryId, request.displayName)
  }

  /**
   * Remove a library: catalog → session mutexes → library.
   * @param request - library id.
   * @param signal - caller lifetime.
   */
  override async removeLibrary(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    const home = this.home()
    await withCatalogLock(home, async () => {
      const document = await readCatalog(home)
      const current = document.libraries.find(row => row.id === request.libraryId)
      if (current === undefined) return
      const deleting = { ...current, deleting: true as const }
      await writeCatalog(home, {
        version: CATALOG_VERSION,
        libraries: document.libraries.map(row => row.id === request.libraryId ? deleting : row),
      })
      const sessionIds = await listBoundSessionIds(this.ctx, request.libraryId)
      await withSessionLocks(sessionIds, async () => {
        await withLibraryLock(request.libraryId, async () => {
          try {
            const vault = await assertVaultDir(home, deleting)
            await recoverPendingAudits(this.ctx, this.config, vault, signal)
          } catch (error: unknown) {
            if (error instanceof AskKnowledgeError && error.code === 'path-escape') throw error
          }
          for (const sessionId of sessionIds) {
            const live = this.ctx.get('sessions')?.get(sessionId)
            if (live !== undefined) {
              await unbindSession(this.ctx, sessionId, request.libraryId)
              continue
            }
            await unbindSession(this.ctx, sessionId, request.libraryId)
          }
          try {
            const vault = await assertVaultDir(home, deleting)
            await runSidecar(this.config, {
              command: 'cancel-library-jobs',
              vault,
              libraryId: request.libraryId,
            }, { signal })
            await rm(vault, { recursive: true, force: true })
          } catch (error: unknown) {
            /* v8 ignore next -- a row that passed recover uses the same vaultRelPath */
            if (error instanceof AskKnowledgeError && error.code === 'path-escape') throw error
          }
          const after = await readCatalog(home)
          await writeCatalog(home, {
            version: CATALOG_VERSION,
            libraries: after.libraries.filter(row => row.id !== request.libraryId),
          })
        })
      })
    })
  }

  /**
   * Bind an existing Session to a library.
   * @param request - library and session identities.
   * @param signal - caller lifetime.
   * @returns a lease whose rollback undoes this attach.
   */
  override async attach(
    request: { libraryId: AskKnowledgeLibraryId; sessionId: SessionId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeAttachLease> {
    signal?.throwIfAborted()
    const home = this.home()
    await withCatalogLock(home, async () => {
      await requireLibrary(home, request.libraryId)
    })
    const lease = await withSessionLock(request.sessionId, async () => {
      return await withLibraryLock(request.libraryId, async () => {
        const row = await requireLibrary(home, request.libraryId)
        const session = this.ctx.get('sessions')?.get(request.sessionId)
        if (session === undefined) {
          throw new AskKnowledgeError('session-busy', `session ${request.sessionId} is not live`)
        }
        const vault = await assertVaultDir(home, row)
        await recoverPendingAudits(this.ctx, this.config, vault, signal)
        await healRejectedProposals(this.config, vault, signal)
        const previous = this.ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')
        if (previous != null && previous.libraryId !== request.libraryId) {
          session.append('ask-knowledge/unbound', { libraryId: previous.libraryId })
        }
        const binding = { libraryId: request.libraryId, displayName: row.displayName }
        if (previous?.libraryId !== request.libraryId) {
          session.append('ask-knowledge/bound', binding)
        }
        return {
          binding,
          rollback: async () => {
            await withSessionLock(request.sessionId, async () => {
              const live = this.ctx.get('sessions')?.get(request.sessionId)
              if (live === undefined) return
              if (previous == null) {
                live.append('ask-knowledge/unbound', { libraryId: request.libraryId })
                return
              }
              live.append('ask-knowledge/bound', previous)
            })
          },
        }
      })
    })
    try {
      await touchLastUsed(home, request.libraryId)
    } catch (error: unknown) {
      /* v8 ignore start -- last-used is advisory; attach already committed */
      if (!(error instanceof AskKnowledgeError) || error.code !== 'library-missing') throw error
      /* v8 ignore stop */
    }
    return lease
  }

  /**
   * Clear the bind on an existing Session.
   * @param request - session identity.
   * @param signal - caller lifetime.
   */
  override async detach(request: { sessionId: SessionId }, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await withSessionLock(request.sessionId, async () => {
      const session = this.ctx.get('sessions')?.get(request.sessionId)
      if (session === undefined) {
        throw new AskKnowledgeError('session-busy', `session ${request.sessionId} is not live`)
      }
      const binding = this.ctx.sessionProjections.stateOf(session, 'askKnowledgeBinding')
      if (binding == null) return
      session.append('ask-knowledge/unbound', { libraryId: binding.libraryId })
    })
  }

  /**
   * Open an ingest upload.
   * @param request - library and original filename.
   * @param signal - caller lifetime.
   * @returns a handle used by append / finish.
   */
  override async beginIngest(
    request: { libraryId: AskKnowledgeLibraryId; filename: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestHandle> {
    signal?.throwIfAborted()
    await requireLibrary(this.home(), request.libraryId)
    const upload = await beginUpload(this.home(), request.libraryId, request.filename)
    this.uploads.set(upload.handle, upload)
    return upload.handle
  }

  /**
   * Append one base64 chunk.
   * @param request - handle and canonical base64 bytes.
   * @param signal - caller lifetime.
   */
  override async appendIngestChunk(
    request: { handle: AskKnowledgeIngestHandle; bytes: string },
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    const upload = this.uploads.get(request.handle)
    if (upload === undefined) {
      throw new AskKnowledgeError('ingest-failed', 'unknown ingest handle')
    }
    appendUpload(
      upload,
      decodeIngestChunk(request.bytes),
      this.config.maxIngestBytes ?? DEFAULT_MAX_INGEST_BYTES,
    )
  }

  /**
   * Assemble chunks and run ingest → propose → apply.
   * @param request - handle and optional raw reuse path.
   * @param signal - caller lifetime.
   * @returns ingest status.
   */
  override async finishIngest(
    request: { handle: AskKnowledgeIngestHandle; reuseRawPath?: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestResult> {
    signal?.throwIfAborted()
    this.requireSidecarHome()
    const upload = this.uploads.get(request.handle)
    if (upload === undefined) {
      throw new AskKnowledgeError('ingest-failed', 'unknown ingest handle')
    }
    await this.ready
    const operationSignal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    let conversionRun: { key: string; settle: () => void } | undefined
    try {
      if (request.reuseRawPath !== undefined) {
        throw new AskKnowledgeError('ingest-failed', 'Use the document Retry action; raw reuse cannot bypass spending approval')
      }
      await materializeUpload(upload)
      const stored = await storeSourceOriginal(this.config, this.home(), upload.libraryId,
        upload.filename, createReadStream(upload.path), undefined, operationSignal)
      const row = await requireLibrary(this.home(), upload.libraryId)
      const vault = await assertVaultDir(this.home(), row)
      const attempt = await getLibraryStartupAttempt(this.config, this.home(), upload.libraryId)
      const job = await createTrackedJob(this.config, this.home(), upload.libraryId, stored.document.id,
        stored.revision.revisionId, attempt, 'conversion')
      const controller = new AbortController()
      const conversionSignal = AbortSignal.any([operationSignal, controller.signal])
      const completion = Promise.withResolvers<void>()
      const key = `${upload.libraryId}:${stored.document.id}`
      this.documentRuns.set(key, { controller, done: completion.promise })
      conversionRun = { key, settle: completion.resolve }
      let converted: ConversionResult
      try {
        converted = await convertSourceFile(this.config, upload.path, upload.filename, { signal: conversionSignal })
        conversionSignal.throwIfAborted()
      } catch (error) {
        await runSidecar(this.config, { command: 'record-conversion', vault, libraryId: upload.libraryId,
          documentId: stored.document.id, jobId: job.jobId, conversionStatus: 'failed',
          error: error instanceof Error ? error.message : String(error) }, { signal: this.lifetime.signal })
        throw error
      }
      if (!converted.markdown) {
        await runSidecar(this.config, { command: 'record-conversion', vault, libraryId: upload.libraryId,
          documentId: stored.document.id, jobId: job.jobId, revisionId: stored.revision.revisionId,
          conversion: converted.diagnostics, conversionStatus: converted.status,
          error: converted.error ?? converted.status }, { signal: operationSignal })
        return { status: 'failed', retryable: true, error: converted.error ?? converted.status }
      }
      const rawRelPath = `raw/${stored.document.id}-${stored.revision.revisionId}.md`
      await withLibraryLock(upload.libraryId, async () => {
        conversionSignal.throwIfAborted()
        await requireLibrary(this.home(), upload.libraryId)
        conversionSignal.throwIfAborted()
        await publishRawText(vault, rawRelPath, converted.markdown, conversionSignal)
      })
      await indexLibraryVault(this.config, this.home(), upload.libraryId, operationSignal)
      try { await runSidecar(this.config, { command: 'plan-document', vault, libraryId: upload.libraryId,
        documentId: stored.document.id, revisionId: stored.revision.revisionId, jobId: job.jobId, rawPath: rawRelPath,
        conversion: converted.diagnostics, conversionStatus: converted.status,
        chunkChars: this.config.extractionChunkChars ?? 1500,
        contextChars: this.config.extractionContextChars ?? 2000,
        outputReserve: this.config.extractionOutputTokens ?? 2048 }, { signal: operationSignal }) } catch (error) {
        await runSidecar(this.config, { command: 'record-conversion', vault, libraryId: upload.libraryId,
          documentId: stored.document.id, conversionStatus: 'failed', conversion: converted.diagnostics,
          error: error instanceof Error ? error.message : String(error) }, { signal: this.lifetime.signal })
        throw error
      }
      return { status: 'deferred', rawRelPath, deferredCount: 1 }
    } finally {
      if (conversionRun) {
        this.documentRuns.delete(conversionRun.key)
        conversionRun.settle()
      }
      this.uploads.delete(request.handle)
      await disposeUpload(upload)
    }
  }

  /**
   * Open a session-only extract upload. Does not require a library.
   * @param request - original filename.
   * @param signal - caller lifetime.
   * @returns a handle used by append / finish extract.
   */
  override async beginExtract(
    request: { filename: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestHandle> {
    signal?.throwIfAborted()
    const upload = await beginExtractUpload(this.home(), request.filename)
    this.uploads.set(upload.handle, upload)
    return upload.handle
  }

  /**
   * Append one base64 chunk to a session-only extract upload.
   * @param request - handle and canonical base64 bytes.
   * @param signal - caller lifetime.
   */
  override appendExtractChunk(
    request: { handle: AskKnowledgeIngestHandle; bytes: string },
    signal?: AbortSignal,
  ): Promise<void> {
    return this.appendIngestChunk(request, signal)
  }

  /**
   * Convert the assembled file to text and delete the temp file. Does not write catalog.
   * @param request - handle.
   * @param signal - caller lifetime.
   * @returns extracted text.
   */
  override async finishExtract(
    request: { handle: AskKnowledgeIngestHandle },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeExtractResult> {
    signal?.throwIfAborted()
    const upload = this.uploads.get(request.handle)
    if (upload === undefined) {
      throw new AskKnowledgeError('ingest-failed', 'unknown extract handle')
    }
    if (!isDocxExtractFilename(upload.filename)) this.requireSidecarHome()
    try {
      await materializeUpload(upload)
      return await convertUploadToText(this.config, upload, signal)
    } finally {
      this.uploads.delete(request.handle)
      await disposeUpload(upload)
    }
  }

  /**
   * Recover pending audits and return status.
   * @param request - library id.
   * @param signal - caller lifetime.
   * @returns catalog row plus pending audit count.
   */
  override async libraryStatus(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeStatus> {
    signal?.throwIfAborted()
    const row = await requireLibrary(this.home(), request.libraryId)
    try {
      this.requireSidecarHome()
      const vault = await assertVaultDir(this.home(), row)
      await withLibraryLock(request.libraryId, () =>
        recoverPendingAudits(this.ctx, this.config, vault, signal))
    } catch (error: unknown) {
      if (error instanceof AskKnowledgeError && error.code === 'path-escape') throw error
      // recover / sidecar failure still returns the catalog row
    }
    const [library] = (await listCatalog(this.home())).filter(item => item.id === row.id)
    /* v8 ignore next 3 -- requireLibrary already proved the row exists */
    if (library === undefined) {
      throw new AskKnowledgeError('library-missing', `unknown library ${request.libraryId}`)
    }
    let pending = 0
    try {
      const vault = await assertVaultDir(this.home(), row)
      pending = await pendingAuditCount(this.config, vault, signal)
    } catch {
      /* v8 ignore next -- pendingAuditCount swallows sidecar failures */
      pending = 0
    }
    return { library, pendingAuditCount: pending }
  }

  /**
   * Retrieve pages for already-validated terms.
   * @param request - library and terms.
   * @param signal - caller lifetime.
   * @returns a bounded bundle.
   */
  override retrieveBundle(
    request: { libraryId: AskKnowledgeLibraryId; terms: string[] },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeBundle> {
    this.requireSidecarHome()
    return retrieveLibraryBundle(
      this.config,
      this.home(),
      request.libraryId,
      request.terms,
      this.bounds,
      signal,
    )
  }

  /**
   * Look up one term and attach sidecar body.
   * @param request - library and term.
   * @param signal - caller lifetime.
   * @returns lookup fields plus optional text.
   */
  override lookup(
    request: { libraryId: AskKnowledgeLibraryId; term: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLookup> {
    this.requireSidecarHome()
    return lookupLibraryTerm(
      this.config,
      this.home(),
      request.libraryId,
      request.term,
      this.bounds,
      signal,
    )
  }

  /**
   * Place or refresh the workspace-folder symlink.
   * @param request - library and workspace.
   * @param signal - caller lifetime.
   * @returns whether the shortcut was written.
   */
  override async placeShortcut(
    request: { libraryId: AskKnowledgeLibraryId; workspaceId: WorkspaceId },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; path?: string; reason?: string }> {
    signal?.throwIfAborted()
    return placeLibraryShortcut(this.ctx, this.home(), request.libraryId, request.workspaceId)
  }

  /**
   * Reveal the vault in the host file manager.
   * @param request - library id.
   * @param signal - caller lifetime.
   */
  override async revealLibrary(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    await revealLibraryVault(this.home(), request.libraryId)
  }

  /**
   * Record last-used time after a successful attach.
   * @param libraryId - catalog id.
   */
  async markUsed(libraryId: AskKnowledgeLibraryId): Promise<void> {
    await touchLastUsed(this.home(), libraryId)
  }

  /** Await source-registration repair and job recovery before accepting writes. */
  private async initialize(): Promise<void> {
    let home: string
    try { home = this.home() } catch (error) {
      if (error instanceof AskKnowledgeError && error.code === 'knowledge-home-missing') return
      throw error
    }
    const catalog = await readCatalog(home)
    for (const library of catalog.libraries) {
      if (library.deleting) continue
      await recoverSourceRegistrations(this.config, home, library.id, this.lifetime.signal)
      const attempt = await initLibraryStartupAttempt(this.config, home, library.id)
      await recoverLibraryJobs(this.config, home, library.id, attempt)
    }
    await this.resumeDeletingRows(home)
  }

  /** List durable document state for the authenticated desktop connection.
   * @param libraryId - catalog library to inspect.
   * @returns retained source and processing status rows.
   */
  @Remote('documents')
  async remoteDocuments(libraryId: DocumentLibraryId): Promise<readonly DocumentView[]> {
    await this.ready
    const vault = await assertVaultDir(this.home(), await requireLibrary(this.home(), libraryId))
    const result = await runSidecar(this.config, { command: 'document-status', vault, libraryId }, { signal: this.lifetime.signal })
    if (!Array.isArray(result.documents)) throw new Error('Invalid document status response')
    return result.documents as DocumentView[]
  }

  /** Apply a document lifecycle operation; approval identifies the exact estimate displayed.
   * @param request - document, operation and explicit spending authorization.
   */
  @Remote('documentAction')
  async remoteDocumentAction(request: DocumentActionRequest): Promise<void> {
    await this.ready
    const { libraryId, documentId, action } = request
    const vault = await assertVaultDir(this.home(), await requireLibrary(this.home(), libraryId))
    const key = `${libraryId}:${documentId}`
    if (action === 'cancel') {
      await runSidecar(this.config, { command: 'document-action', vault, libraryId, documentId, action }, { signal: this.lifetime.signal })
      const run = this.documentRuns.get(key)
      run?.controller.abort()
      await run?.done.catch((error) => { if (!run.controller.signal.aborted) throw error })
      return
    }
    if (action === 'original' || action === 'text' || action === 'sources') {
      const documents = await this.remoteDocuments(libraryId)
      const document = documents.find(item => item.id === documentId)
      if (!document) throw new Error('Document is not in this library')
      let path: string
      if (action === 'original') {
        const original = await readSourceOriginal(
          this.config, this.home(), libraryId, RevisionId(document.revisionId), this.lifetime.signal,
        )
        path = original.absPath
      } else {
        const result = await runSidecar(this.config, { command: 'document-location', vault, libraryId, documentId, action }, { signal: this.lifetime.signal })
        if (typeof result.path !== 'string') throw new Error('Document has no extracted text')
        path = join(vault, result.path)
        const rel = relative(await realpath(vault), await realpath(path))
        if (rel.startsWith('..') || isAbsolute(rel) || (await lstat(path)).isSymbolicLink()) throw new Error('Linked document refused')
      }
      if (!canOpenNativePath()) throw new Error('Host cannot open local files')
      await openNativePath(path, this.lifetime.signal)
      return
    }
    if (action === 'retry') {
      const document = (await this.remoteDocuments(libraryId)).find(item => item.id === documentId)
      if (!document) throw new Error('Document is not in this library')
      if (document.stage === 'conversion') {
        const original = await readSourceOriginal(
          this.config, this.home(), libraryId, RevisionId(document.revisionId), this.lifetime.signal,
        )
        const converted = await convertSourceFile(this.config, original.absPath, document.filename, { signal: this.lifetime.signal })
        if (!converted.markdown) {
          await runSidecar(this.config, { command: 'record-conversion', vault, libraryId, documentId,
            conversionStatus: converted.status, conversion: converted.diagnostics, error: converted.error ?? converted.status })
          throw new Error(converted.error ?? converted.status)
        }
        const rawPath = `raw/${documentId}-${document.revisionId}.md`
        await withLibraryLock(libraryId, async () => {
          await publishRawText(vault, rawPath, converted.markdown, this.lifetime.signal)
        })
        await indexLibraryVault(this.config, this.home(), libraryId, this.lifetime.signal)
        await runSidecar(this.config, { command: 'plan-document', vault, libraryId, documentId,
          revisionId: document.revisionId, rawPath, conversion: converted.diagnostics,
          chunkChars: this.config.extractionChunkChars ?? 1500, outputReserve: this.config.extractionOutputTokens ?? 2048 })
        return
      }
      await runSidecar(this.config, { command: 'document-action', vault, libraryId, documentId, action }, { signal: this.lifetime.signal })
      return
    }
    if (this.documentRuns.has(key)) throw new Error('Document extraction is already running')
    if (!request.planHash || !Number.isSafeInteger(request.approvedTokens) || (request.approvedTokens ?? 0) < 1) {
      throw new Error('Review the complete document estimate and approve its budget first')
    }
    const controller = new AbortController()
    const runSignal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const done = (async () => {
      const env = await resolveProposeEnv(this.ctx)
      await runSidecar(this.config, { command: 'execute-document', vault, libraryId, documentId,
        expectedPlanHash: request.planHash, approvedTokens: request.approvedTokens }, {
        env, signal: runSignal, timeoutMs: this.config.extractionTimeoutMs ?? 1800000,
      })
    })()
    this.documentRuns.set(key, { controller, done })
    try { await done } finally { this.documentRuns.delete(key) }
  }

  private home(): string {
    return resolveKnowledgeHome(this.config)
  }

  private requireSidecarHome(): string {
    return resolveSidecarHome(this.config)
  }

  private async resumeDeletingRows(home: string): Promise<void> {
    const document = await readCatalog(home)
    for (const row of document.libraries) {
      if (row.deleting === true) {
        await this.removeLibrary({ libraryId: row.id })
      }
    }
  }
}

void catalogPath
void resumeDeleting

/**
 * Current Agent preset of a Session, when the projection is registered.
 * @param ctx - Host context.
 * @param session - live Session.
 * @returns the preset id, or undefined when the unit is absent.
 */
function sessionPreset(ctx: Context, session: object): string | undefined {
  const projections = ctx.sessionProjections as {
    stateOf(target: object, key: string): unknown
  }
  const value = projections.stateOf(session, 'agentPreset')
  return typeof value === 'string' ? value : undefined
}

/** Publish complete normalized bytes without exposing an unfinished .md file. */
async function publishRawText(vault: string, relativePath: string, text: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const directory = join(vault, 'raw')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Linked raw directory refused')
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(text, 'utf8')
    await file.sync()
  } finally { await file.close() }
  try {
    signal.throwIfAborted()
    const target = join(vault, relativePath)
    try { await link(temporary, target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await lstat(target)).isSymbolicLink()
        || await readFile(target, 'utf8') !== text) throw error
    }
  } finally { await unlink(temporary) }
}
