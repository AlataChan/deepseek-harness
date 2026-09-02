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
  resumeDeleting, touchLastUsed, writeCatalog, catalogPath, assertVaultDir,
} from './catalog.ts'
import { CATALOG_VERSION } from './catalog.ts'
import { resolveKnowledgeHome, type AskKnowledgeHomeConfig } from './knowledge-home.ts'
import {
  withCatalogLock, withLibraryLock, withSessionLock, withSessionLocks,
} from './library-lock.ts'
import { renderAskKnowledgeRetrievePrompt } from './prompt-retrieve.ts'
import { finishIngestPipeline, pendingAuditCount, recoverPendingAudits } from './ingest.ts'
import { lookupLibraryTerm, retrieveLibraryBundle } from './retrieve.ts'
import { resolveResultBounds, type ResultBounds } from './result-bounds.ts'
import { placeLibraryShortcut, revealLibraryVault } from './shortcut.ts'
import { registerAskKnowledgeTools } from './tools.ts'
import { listBoundSessionIds, unbindSession } from './unbind.ts'
import { convertUploadToText } from './extract.ts'
import { isDocxExtractFilename, writeDocxMarkdownForIngest } from './extract-docx.ts'
import {
  appendUpload, beginExtractUpload, beginUpload, decodeIngestChunk, DEFAULT_MAX_INGEST_BYTES,
  disposeUpload, materializeUpload, type IngestUpload,
} from './upload-temp.ts'
import { resolveSidecarHome } from './knowledge-home.ts'
import { rm } from 'node:fs/promises'

export { MISSING_API_KEY_MESSAGE, resolveProposeEnv } from './credentials-bridge.ts'
export { runSidecar, resolveSidecarExecutable, packagePythonDir } from './sidecar.ts'
export { boundRetrieveResult, resolveResultBounds, tokenEstimate, clipItemText } from './result-bounds.ts'
export { parseAskKnowledgeTerms, parseAskKnowledgeLookupTerm } from '@deepseek-ai/dsh-host-ask-knowledge'
export { withSessionLock, withLibraryLock, withCatalogLock, withSessionLocks } from './library-lock.ts'
export { renderAskKnowledgeRetrievePrompt } from './prompt-retrieve.ts'

/** Validated plugin configuration. */
export interface Config extends AskKnowledgeHomeConfig {
  /** Ceiling of one ingest file in bytes after the last chunk is joined. */
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
    maxIngestBytes: z.natural().default(DEFAULT_MAX_INGEST_BYTES),
    maxResultItems: z.natural().default(12),
    maxResultChars: z.natural().default(24_000),
    maxResultTokens: z.natural().default(6000),
  })

  private readonly config: Config
  private readonly uploads = new Map<string, IngestUpload>()
  private readonly bounds: ResultBounds

  /**
   * @param ctx - Host context that registers this service.
   * @param config - validated knowledge-home override.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
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
      ctx.effect(() => registerAskKnowledgeTools(ctx), 'desktop-ask-knowledge.tools')
    }
    ctx.effect(() => {
      try {
        const home = this.home()
        void this.resumeDeletingRows(home)
      } catch (error: unknown) {
        /* v8 ignore start -- home() only throws knowledge-home-missing */
        if (!(error instanceof AskKnowledgeError) || error.code !== 'knowledge-home-missing') {
          throw error
        }
        /* v8 ignore stop */
      }
      return () => {}
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
    try {
      let tempPath = upload.path
      if (request.reuseRawPath === undefined) {
        await materializeUpload(upload)
        tempPath = await writeDocxMarkdownForIngest(upload)
      }
      return await finishIngestPipeline(this.ctx, this.config, this.home(), {
        libraryId: upload.libraryId,
        tempPath,
        ...request.reuseRawPath === undefined ? {} : { reuseRawPath: request.reuseRawPath },
      }, signal)
    } finally {
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
