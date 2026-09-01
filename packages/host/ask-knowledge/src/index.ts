/**
 * Service Definition for the `ctx.askKnowledge` capability seam: list
 * libraries, ingest documents, extract a file for one session, and bind one
 * library to an already-created Session. Providers implement the catalog,
 * vault, and sidecar. The Consumer (`session-controller`) only calls these methods.
 * @module @deepseek-ai/dsh-host-ask-knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { AskKnowledgeBinding } from './types.ts'

export type { AskKnowledgeBinding } from './types.ts'
export { askKnowledgeBindingProjectionDefinition } from './session.ts'
export {
  ASK_KNOWLEDGE_LOOKUP_SCHEMA,
  ASK_KNOWLEDGE_TERM_FORBIDDEN,
  ASK_KNOWLEDGE_TERM_MAX_COUNT,
  ASK_KNOWLEDGE_TERM_MAX_LENGTH,
  ASK_KNOWLEDGE_TERM_MIN_COUNT,
  ASK_KNOWLEDGE_TERMS_SCHEMA,
  parseAskKnowledgeLookupTerm,
  parseAskKnowledgeTerms,
} from './terms.ts'
export type { AskKnowledgeNoHit, AskKnowledgeTermsInvalid } from './terms.ts'

/** Stable id of one overlay-managed knowledge library. */
export type AskKnowledgeLibraryId = Branded<'AskKnowledgeLibraryId'>

/**
 * Brand a string as an {@link AskKnowledgeLibraryId}.
 * @param id - raw library id.
 * @returns the same string with the library-id brand.
 */
export function AskKnowledgeLibraryId(id: string): AskKnowledgeLibraryId {
  return brandString<AskKnowledgeLibraryId>(id)
}

/** Opaque handle of one in-flight ingest upload. */
export type AskKnowledgeIngestHandle = Branded<'AskKnowledgeIngestHandle'>

/**
 * Brand a string as an {@link AskKnowledgeIngestHandle}.
 * @param id - raw handle id.
 * @returns the same string with the ingest-handle brand.
 */
export function AskKnowledgeIngestHandle(id: string): AskKnowledgeIngestHandle {
  return brandString<AskKnowledgeIngestHandle>(id)
}

/** One row of {@link AskKnowledge.listLibraries}. */
export interface AskKnowledgeLibrary {
  readonly id: AskKnowledgeLibraryId
  readonly displayName: string
  readonly createdAt: string
  readonly lastUsedAt: string
  readonly missing: boolean
  readonly deleting: boolean
  readonly hasWorkspaceShortcut?: boolean
}

/** Same-process undo of one {@link AskKnowledge.attach}. */
export interface AskKnowledgeAttachLease {
  readonly binding: AskKnowledgeBinding
  rollback(): Promise<void>
}

/** Maximum characters {@link AskKnowledge.finishExtract} returns. */
export const ASK_KNOWLEDGE_EXTRACT_MAX_CHARS = 32_000

/** Result of {@link AskKnowledge.finishExtract}. */
export interface AskKnowledgeExtractResult {
  readonly filename: string
  readonly text: string
  readonly truncated: boolean
}

/** Result of {@link AskKnowledge.finishIngest}. */
export interface AskKnowledgeIngestResult {
  readonly status: 'applied' | 'deferred' | 'failed'
  readonly deferredCount?: number
  readonly rawRelPath?: string
  readonly retryable?: boolean
  readonly proposalId?: string
  /** Operator-facing reason when `status` is `failed`. */
  readonly error?: string
}

/** Status shown on the library management row. */
export interface AskKnowledgeStatus {
  readonly library: AskKnowledgeLibrary
  readonly pendingAuditCount: number
}

/** One retrieved page after sidecar body load and result bounds. */
export interface AskKnowledgeBundleItem {
  readonly path: string
  readonly title: string
  readonly reason: string
  readonly text: string
  readonly kind: 'concept' | 'entity' | 'raw'
}

/** Bounded retrieve payload. */
export interface AskKnowledgeBundle {
  readonly items: readonly AskKnowledgeBundleItem[]
  readonly warnings: readonly { readonly ruleId: string; readonly message: string }[]
  readonly tokenEstimate: number
}

/** Lookup payload with sidecar-supplied body. */
export interface AskKnowledgeLookup {
  readonly term: string
  readonly canonicalPath?: string
  readonly text?: string
  readonly warnings: readonly { readonly ruleId: string; readonly message: string }[]
}

/** Closed failure vocabulary of the ask-knowledge primitives. */
export type AskKnowledgeErrorCode =
  | 'ask-knowledge-unavailable'
  | 'knowledge-home-missing'
  | 'sidecar-home-missing'
  | 'library-missing'
  | 'library-deleting'
  | 'path-escape'
  | 'terms-invalid'
  | 'no-hit'
  | 'type-unsupported'
  | 'chunk-too-large'
  | 'file-too-large'
  | 'credentials-missing'
  | 'ingest-failed'
  | 'session-busy'
  | 'not-ready'

/** Typed failure thrown by the seam so consumers can map wire codes. */
export class AskKnowledgeError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   * @param details - optional rule id or numeric limit.
   */
  constructor(
    readonly code: AskKnowledgeErrorCode,
    message: string,
    readonly details: { readonly ruleId?: string; readonly limit?: number } = {},
  ) {
    super(message)
    this.name = 'AskKnowledgeError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    askKnowledge: AskKnowledge
  }
}

/**
 * Abstract library catalog, ingest, attach, and retrieve. Subclass, implement
 * the methods, and load the subclass as a plugin — it registers as
 * `ctx.askKnowledge`. The class itself is not a mounted plugin.
 */
export abstract class AskKnowledge extends Service {
  /**
   * @param ctx - Host context that registers this service.
   */
  constructor(ctx: Context) {
    super(ctx, 'askKnowledge')
  }

  /**
   * List catalog rows. Does not run recover.
   * @param signal - caller lifetime; abort stops the listing.
   * @returns catalog rows, `missing` when the vault directory vanished.
   */
  abstract listLibraries(signal?: AbortSignal): Promise<AskKnowledgeLibrary[]>

  /**
   * Create an empty vault and catalog row. Does not attach a session.
   * @param request - display name and optional workspace for a shortcut.
   * @param signal - caller lifetime; abort stops the create.
   * @returns the new catalog row.
   */
  abstract createLibrary(
    request: { displayName: string; workspaceId?: WorkspaceId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary>

  /**
   * Rename a catalog row. Does not rename the vault directory id.
   * @param request - library id and new display name.
   * @param signal - caller lifetime; abort stops the rename.
   * @returns the updated row.
   */
  abstract renameLibrary(
    request: { libraryId: AskKnowledgeLibraryId; displayName: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLibrary>

  /**
   * Mark the row `deleting`, unbind live and cold sessions, delete the vault,
   * then drop the catalog row. Holds catalog for the whole transaction.
   * @param request - library id.
   * @param signal - caller lifetime; abort stops the remove.
   */
  abstract removeLibrary(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<void>

  /**
   * Bind an existing Session to a library. Recovers pending audits first.
   * @param request - library and session identities.
   * @param signal - caller lifetime; abort stops the attach.
   * @returns a lease whose `rollback` undoes this attach in-process.
   */
  abstract attach(
    request: { libraryId: AskKnowledgeLibraryId; sessionId: SessionId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeAttachLease>

  /**
   * Clear the bind on an existing Session.
   * @param request - session identity.
   * @param signal - caller lifetime; abort stops the detach.
   */
  abstract detach(request: { sessionId: SessionId }, signal?: AbortSignal): Promise<void>

  /**
   * Open an ingest upload. Does not take the library lock.
   * @param request - library and original filename.
   * @param signal - caller lifetime; abort stops the begin.
   * @returns a handle used by {@link appendIngestChunk} and {@link finishIngest}.
   */
  abstract beginIngest(
    request: { libraryId: AskKnowledgeLibraryId; filename: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestHandle>

  /**
   * Append one base64 chunk. Decoded size must be ≤ 160KiB.
   * @param request - handle and canonical base64 bytes.
   * @param signal - caller lifetime; abort stops the append.
   */
  abstract appendIngestChunk(
    request: { handle: AskKnowledgeIngestHandle; bytes: string },
    signal?: AbortSignal,
  ): Promise<void>

  /**
   * Assemble chunks, take the library lock, and run ingest → propose → apply.
   * @param request - handle and optional raw reuse path.
   * @param signal - caller lifetime; abort stops the finish.
   * @returns applied, deferred, or failed ingest status.
   */
  abstract finishIngest(
    request: { handle: AskKnowledgeIngestHandle; reuseRawPath?: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestResult>

  /**
   * Open a session-only extract upload. Does not require a library.
   * @param request - original filename.
   * @param signal - caller lifetime; abort stops the begin.
   * @returns a handle used by {@link appendExtractChunk} and {@link finishExtract}.
   */
  abstract beginExtract(
    request: { filename: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeIngestHandle>

  /**
   * Append one base64 chunk to a session-only extract upload.
   * @param request - handle and canonical base64 bytes.
   * @param signal - caller lifetime; abort stops the append.
   */
  abstract appendExtractChunk(
    request: { handle: AskKnowledgeIngestHandle; bytes: string },
    signal?: AbortSignal,
  ): Promise<void>

  /**
   * Assemble chunks, convert to text, and delete the temp file. Does not write catalog or vault.
   * @param request - handle.
   * @param signal - caller lifetime; abort stops the finish.
   * @returns extracted text, truncated when longer than {@link ASK_KNOWLEDGE_EXTRACT_MAX_CHARS}.
   */
  abstract finishExtract(
    request: { handle: AskKnowledgeIngestHandle },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeExtractResult>

  /**
   * Recover pending audits for one library and return its status.
   * @param request - library id.
   * @param signal - caller lifetime; abort stops the status read.
   * @returns catalog row plus pending audit count.
   */
  abstract libraryStatus(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeStatus>

  /**
   * Retrieve pages for already-validated terms and load bodies.
   * @param request - library and terms.
   * @param signal - caller lifetime; abort stops the retrieve.
   * @returns a bounded bundle. Empty pre-trim concept+entity+raw is `no-hit`.
   */
  abstract retrieveBundle(
    request: { libraryId: AskKnowledgeLibraryId; terms: string[] },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeBundle>

  /**
   * Look up one term and attach sidecar body when a canonical path exists.
   * @param request - library and term.
   * @param signal - caller lifetime; abort stops the lookup.
   * @returns lookup fields plus optional text.
   */
  abstract lookup(
    request: { libraryId: AskKnowledgeLibraryId; term: string },
    signal?: AbortSignal,
  ): Promise<AskKnowledgeLookup>

  /**
   * Place or refresh the workspace-folder symlink. Failure does not roll back create.
   * @param request - library and workspace.
   * @param signal - caller lifetime; abort stops the write.
   * @returns whether the shortcut was written.
   */
  abstract placeShortcut(
    request: { libraryId: AskKnowledgeLibraryId; workspaceId: WorkspaceId },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; path?: string; reason?: string }>

  /**
   * Reveal the vault in the host file manager.
   * @param request - library id.
   * @param signal - caller lifetime; abort stops the reveal.
   */
  abstract revealLibrary(
    request: { libraryId: AskKnowledgeLibraryId },
    signal?: AbortSignal,
  ): Promise<void>
}

export default AskKnowledge
