/**
 * Client-safe media remotes. Cast `ctx.remote.session` to this face.
 * @module @deepseek-ai/dsh-experimental-desktop-media/client/remotes
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** One Works row on the wire. */
export interface MediaWorkRow {
  readonly artifactId: string
  readonly requestId: string
  readonly kind: 'video' | 'speech' | 'composed' | 'import'
  readonly name: string
  readonly sessionId: string
  readonly workspaceId?: string
  readonly createdAt: string
  readonly durationSeconds?: number
}

/** Voice row on the wire. */
export interface MediaVoiceRow {
  readonly voiceId: string
  readonly label: string
  readonly system: boolean
}

/** Runtime status on the wire. */
export interface MediaRuntimeRow {
  readonly ready: boolean
  readonly guidance: string
}

/** Session remotes used by the media overlay. */
export interface MediaSessionRemotes {
  listMediaWorks(request: {
    workspaceId?: string
    sessionId?: string
  }, signal?: AbortSignal): Promise<RemoteResult<readonly MediaWorkRow[]>>
  mediaRuntimeStatus(signal?: AbortSignal): Promise<RemoteResult<MediaRuntimeRow>>
  openMediaWork(request: { artifactId: string }, signal?: AbortSignal): Promise<RemoteResult<{ requested: true }>>
  revealMediaWork(request: { artifactId: string }, signal?: AbortSignal): Promise<RemoteResult<{ requested: true }>>
  copyMediaWorkPath(request: { artifactId: string }): Promise<RemoteResult<{ path: string }>>
  listMediaVoices(signal?: AbortSignal): Promise<RemoteResult<readonly MediaVoiceRow[]>>
  importMediaBytes(request: {
    filename: string
    bytes: string
    sessionId: string
    workspaceId?: string
  }, signal?: AbortSignal): Promise<RemoteResult<MediaWorkRow>>
  saveMediaWorkAs(request: {
    artifactId: string
    directory: string
    filename: string
  }, signal?: AbortSignal): Promise<RemoteResult<{ path: string }>>
}

/** Credential facts a configuration surface may show. Never includes the secret. */
export interface MediaCredentialInfo {
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
}

/** Credentials remotes used by the MiniMax key card. */
export interface MediaCredentialsRemotes {
  describe(refs: string[], signal?: AbortSignal): Promise<RemoteResult<Record<string, MediaCredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult<void>>
}
