/**
 * Typed failures for desktop-media Host helpers.
 * @module @deepseek-ai/dsh-experimental-desktop-media/error
 */

/** Closed failure codes for media home, runtime, composition, system open, and MiniMax. */
export type MediaErrorCode =
  | 'runtime-missing'
  | 'runtime-relative'
  | 'runtime-unready'
  | 'license-unverified'
  | 'encoder-missing'
  | 'path-not-absolute'
  | 'path-not-a-file'
  | 'input-missing'
  | 'probe-invalid'
  | 'probe-no-video'
  | 'clips-empty'
  | 'narration-too-long'
  | 'open-unsupported'
  | 'credential-missing'
  | 'provider-http'
  | 'provider-invalid'
  | 'task-failed'
  | 'task-timeout'
  | 'budget-exhausted'
  | 'approval-required'
  | 'approval-mismatch'
  | 'consent-missing'
  | 'image-mode-conflict'
  | 'import-rejected'
  | 'save-as-exists'
  | 'artifact-missing'
  | 'voice-unavailable'
  | 'session-mismatch'

/**
 * Host-local media failure. Callers switch on {@link MediaError.code}.
 */
export class MediaError extends Error {
  /**
   * @param code - closed failure code.
   * @param message - operator-facing explanation without secrets or signed URLs.
   */
  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'MediaError'
  }
}
