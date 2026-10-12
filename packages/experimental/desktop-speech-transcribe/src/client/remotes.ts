/**
 * Client-safe transcript-audio remotes projected from the generated session
 * Remote namespace.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/client/remotes
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** One staged recording on the wire. */
export interface StagedTranscriptAudioRow {
  /** Workspace-relative POSIX path the transcription tool can read. */
  readonly path: string
  /** Stored file name, suffixed when a same-name file already existed. */
  readonly filename: string
}

/** Session remotes used by the 录音转文字 row. */
export interface TranscriptAudioRemotes {
  importTranscriptAudio: (request: {
    filename: string
    bytes: string
    sessionId: SessionId
    workspaceId?: string
  }, signal?: AbortSignal) => Promise<RemoteResult<StagedTranscriptAudioRow>>
}
