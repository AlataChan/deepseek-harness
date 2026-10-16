/**
 * Types and branded IDs for documents, immutable source revisions, and storage records.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/document-types
 */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'

/** Branded identifier for a logical document. */
export type DocumentId = Branded<'DocumentId'>
/**
 * Create a branded DocumentId.
 * @param id - serialized identifier.
 * @returns the branded identifier.
 */
export const DocumentId = (id: string): DocumentId => brandString<DocumentId>(id)

/** Branded identifier for an immutable source revision. */
export type RevisionId = Branded<'RevisionId'>
/**
 * Create a branded RevisionId.
 * @param id - serialized identifier.
 * @returns the branded identifier.
 */
export const RevisionId = (id: string): RevisionId => brandString<RevisionId>(id)

/** Branded identifier for a document processing job. */
export type JobId = Branded<'JobId'>
/**
 * Create a branded JobId.
 * @param id - serialized identifier.
 * @returns the branded identifier.
 */
export const JobId = (id: string): JobId => brandString<JobId>(id)

/** Status of a logical document in the library. */
export type DocumentStatus = 'retained' | 'converting' | 'indexed' | 'failed' | 'deleted'

/** Integrity and storage status of an uploaded source revision. */
export type RevisionStatus = 'retained' | 'corrupt' | 'unavailable'

/** Logical document record owning one or more revisions. */
export interface DocumentRecord {
  readonly id: DocumentId
  readonly libraryId: AskKnowledgeLibraryId
  readonly displayFilename: string
  readonly activeRevisionId: RevisionId
  readonly status: DocumentStatus
  readonly createdAt: string
  readonly updatedAt: string
}

/** Immutable source revision record pointing to preserved uploaded bytes. */
export interface SourceRevisionRecord {
  readonly revisionId: RevisionId
  readonly documentId: DocumentId
  readonly libraryId: AskKnowledgeLibraryId
  readonly sha256: string
  readonly byteLength: number
  readonly originalFilename: string
  readonly objectPath: string
  readonly status: RevisionStatus
  readonly importedAt: string
  readonly mimeType?: string | undefined
}

/** Tracked durable job record. */
export interface JobRecord {
  readonly jobId: JobId
  readonly libraryId: AskKnowledgeLibraryId
  readonly documentId: DocumentId
  readonly revisionId: RevisionId
  readonly startupAttempt: number
  readonly stage: string
  readonly status: 'active' | 'completed' | 'failed' | 'cancelled' | 'paused'
  readonly totalChunks: number
  readonly completedChunks: number
  readonly currentChunkIndex: number
  readonly tokenEstimate: number
  readonly tokensUsed: number
  readonly isUncertain: boolean
  readonly error?: string
  readonly checkpointJson?: string
  readonly createdAt: string
  readonly updatedAt: string
}
