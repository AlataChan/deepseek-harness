/**
 * Session events, projection, and job-kind merge for desktop media.
 * @module @deepseek-ai/dsh-experimental-desktop-media/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import type { MediaArtifactId, MediaRequestId, MediaVoiceId } from './ids.ts'

/** Work kind shown on cards and in Works. */
export type MediaWorkKind = 'video' | 'speech' | 'composed' | 'import'

/** Business stage folded from durable events. */
export type MediaStage =
  | 'proposed'
  | 'approved'
  | 'submitted'
  | 'running'
  | 'downloaded'
  | 'composed'
  | 'failed'
  | 'stopped'
  | 'pending-recovery'

/** One creation request snapshot. */
export interface MediaRequestRecord {
  readonly requestId: MediaRequestId
  readonly kind: MediaWorkKind
  readonly stage: MediaStage
  readonly label: string
  readonly model?: string
  readonly promptHash?: string
  readonly inputHashes: readonly string[]
  readonly estimatedYuan: number
  readonly providerTaskId?: string
  readonly jobId?: string
  readonly artifactId?: MediaArtifactId
  readonly stopIntent?: boolean
  readonly failure?: string
}

/** One committed local file. */
export interface MediaArtifactRecord {
  readonly artifactId: MediaArtifactId
  readonly requestId: MediaRequestId
  readonly kind: MediaWorkKind
  readonly name: string
  readonly file: string
  readonly digest: string
  readonly durationSeconds?: number
  readonly sessionId: SessionId
  readonly workspaceId?: string
  readonly createdAt: string
}

/** Voice catalogue row. */
export interface MediaVoiceRecord {
  readonly voiceId: MediaVoiceId
  readonly label: string
  readonly system: boolean
  readonly digest?: string
  readonly consentAt?: string
  readonly lastFormalAt?: string
  readonly speakerIsUser?: boolean
  readonly requestId?: MediaRequestId
}

/** Session projection state. */
export interface MediaProjectionState {
  readonly requests: Readonly<Record<string, MediaRequestRecord>>
  readonly artifacts: Readonly<Record<string, MediaArtifactRecord>>
}

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    media: 'media'
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole creation-request snapshot. */
    'media/request': { readonly version: 1; readonly request: MediaRequestRecord }
    /** Pilot or spend approval bound to hashes. */
    'media/approval': {
      readonly version: 1
      readonly requestId: MediaRequestId
      readonly inputHashes: readonly string[]
      readonly promptHash: string
      readonly estimatedYuan: number
    }
    /** Provider task id after a paid submission. */
    'media/task': {
      readonly version: 1
      readonly requestId: MediaRequestId
      readonly providerTaskId: string
    }
    /** Committed local artifact. */
    'media/artifact': { readonly version: 1; readonly artifact: MediaArtifactRecord }
    /** Explicit stop so recovery does not restart the request. */
    'media/stop': { readonly version: 1; readonly requestId: MediaRequestId }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    media: MediaProjectionState
  }
  interface SessionProjectionMap {
    media: MediaProjectionState
  }
}
