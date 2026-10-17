/**
 * Cordis service provider for Ask Knowledge documents and source retention.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/documents-service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import type { DocumentId, DocumentRecord, RevisionId, SourceRevisionRecord } from './document-types.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { resolveKnowledgeHome } from './knowledge-home.ts'
import { withLibraryLock } from './library-lock.ts'
import { runSidecar } from './sidecar.ts'
import { readSourceOriginal, storeSourceOriginal, verifySourceRevision } from './source-store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    askKnowledgeDocuments?: AskKnowledgeDocumentsService
  }
}

/** Service interface for managing documents and retained source files. */
export interface AskKnowledgeDocumentsService {
  storeOriginal(
    libraryId: AskKnowledgeLibraryId,
    filename: string,
    content: Uint8Array,
    documentId?: DocumentId,
    signal?: AbortSignal,
  ): Promise<{ document: DocumentRecord; revision: SourceRevisionRecord }>

  readOriginal(
    libraryId: AskKnowledgeLibraryId,
    revisionId: RevisionId,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; revision: SourceRevisionRecord; absPath: string }>

  getDocument(
    libraryId: AskKnowledgeLibraryId,
    documentId: DocumentId,
    signal?: AbortSignal,
  ): Promise<DocumentRecord | null>

  listDocuments(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<DocumentRecord[]>

  verifyIntegrity(
    libraryId: AskKnowledgeLibraryId,
    revisionId: RevisionId,
    signal?: AbortSignal,
  ): Promise<boolean>

  migrateLibrary(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; migratedDocuments: number; totalPassages: number }>

  cancelLibraryJobs(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; cancelledCount: number }>
}

/** Implementation of the documents service. */
export class DocumentsServiceImpl implements AskKnowledgeDocumentsService {
  constructor(
    private readonly config: AskKnowledgeHomeConfig,
  ) {}

  private home(): string {
    return resolveKnowledgeHome(this.config)
  }

  async storeOriginal(
    libraryId: AskKnowledgeLibraryId,
    filename: string,
    content: Uint8Array,
    documentId?: DocumentId,
    signal?: AbortSignal,
  ): Promise<{ document: DocumentRecord; revision: SourceRevisionRecord }> {
    return storeSourceOriginal(this.config, this.home(), libraryId, filename, content, documentId, signal)
  }

  async readOriginal(
    libraryId: AskKnowledgeLibraryId,
    revisionId: RevisionId,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; revision: SourceRevisionRecord; absPath: string }> {
    return readSourceOriginal(this.config, this.home(), libraryId, revisionId, signal)
  }

  async getDocument(
    libraryId: AskKnowledgeLibraryId,
    documentId: DocumentId,
    signal?: AbortSignal,
  ): Promise<DocumentRecord | null> {
    return await withLibraryLock(libraryId, async () => {
      signal?.throwIfAborted()
      const row = await requireLibrary(this.home(), libraryId)
      const vault = await assertVaultDir(this.home(), row)
      const res = await runSidecar(this.config, {
        command: 'get-document',
        vault,
        documentId,
      }, { signal })
      return (res.document as DocumentRecord | null) ?? null
    })
  }

  async listDocuments(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<DocumentRecord[]> {
    return await withLibraryLock(libraryId, async () => {
      signal?.throwIfAborted()
      const row = await requireLibrary(this.home(), libraryId)
      const vault = await assertVaultDir(this.home(), row)
      const res = await runSidecar(this.config, {
        command: 'list-documents',
        vault,
        libraryId,
      }, { signal })
      return (Array.isArray(res.documents) ? res.documents : []) as DocumentRecord[]
    })
  }

  async verifyIntegrity(
    libraryId: AskKnowledgeLibraryId,
    revisionId: RevisionId,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return verifySourceRevision(this.config, this.home(), libraryId, revisionId, signal)
  }

  async migrateLibrary(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; migratedDocuments: number; totalPassages: number }> {
    return await withLibraryLock(libraryId, async () => {
      const row = await requireLibrary(this.home(), libraryId)
      const vault = await assertVaultDir(this.home(), row)
      const res = await runSidecar(this.config, {
        command: 'migrate-library',
        vault,
        libraryId,
      }, { signal })
      return {
        ok: res.ok === true,
        migratedDocuments: typeof res.migratedDocuments === 'number' ? res.migratedDocuments : 0,
        totalPassages: typeof res.totalPassages === 'number' ? res.totalPassages : 0,
      }
    })
  }

  async cancelLibraryJobs(
    libraryId: AskKnowledgeLibraryId,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; cancelledCount: number }> {
    return await withLibraryLock(libraryId, async () => {
      const row = await requireLibrary(this.home(), libraryId)
      const vault = await assertVaultDir(this.home(), row)
      const res = await runSidecar(this.config, {
        command: 'cancel-library-jobs',
        vault,
        libraryId,
      }, { signal })
      return {
        ok: res.ok === true,
        cancelledCount: typeof res.cancelledCount === 'number' ? res.cancelledCount : 0,
      }
    })
  }
}

/**
 * Register the documents service on the cordis context.
 * @param ctx - host context.
 * @param config - home configuration.
 * @returns disposer.
 */
export function registerDocumentsService(
  ctx: Context,
  config: AskKnowledgeHomeConfig,
): () => void {
  const service = new DocumentsServiceImpl(config)
  return ctx.provide('askKnowledgeDocuments', service)
}
