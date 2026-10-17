/** Client-safe durable document status and lifecycle requests. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Library identity on the document Remote surface. */
export type DocumentLibraryId = Branded<'AskKnowledgeLibraryId'>

/** Upload handle carried by the document Remote surface. */
export type DocumentIngestHandle = Branded<'AskKnowledgeIngestHandle'>
import type { DocumentId, RevisionId } from './document-types.ts'

/** Stored source and current extraction state presented to the library owner. */
export interface DocumentView {
  readonly id: DocumentId
  readonly libraryId: DocumentLibraryId
  readonly filename: string
  readonly revisionId: RevisionId
  readonly conversionStatus?: string
  readonly originalAvailable: boolean
  readonly textAvailable?: boolean
  readonly searchable: boolean
  readonly stage: string
  readonly status: 'active' | 'completed' | 'failed' | 'paused' | 'queued' | 'retained' | 'cancelled'
  readonly totalChunks: number
  readonly completedChunks: number
  readonly tokensUsed?: number
  readonly usageKnown?: boolean
  readonly retryRequired?: boolean
  readonly chunksWithoutPages?: number
  readonly wikiReady?: boolean
  readonly estimatedTokens: number
  readonly budgetApproved: boolean
  readonly planHash?: string
  readonly error?: string
  readonly needsOcrPage?: number
  readonly uncertainOutcome?: 'replay'
}

/** Registered documents with a nonblocking legacy-import warning. */
export interface DocumentListView {
  readonly documents: readonly DocumentView[]
  readonly migrationWarning?: string
}

/** Desktop-authorized action; inference requires the displayed plan hash and allowance. */
export interface DocumentActionRequest {
  readonly libraryId: DocumentLibraryId
  readonly documentId: DocumentId
  readonly action: 'original' | 'text' | 'sources' | 'retry' | 'resume' | 'cancel' | 'approve'
  readonly planHash?: string
  readonly approvedTokens?: number
  /** Explicit consent to a new paid attempt after an uncertain provider outcome. */
  readonly uncertainOutcome?: 'replay'
}
