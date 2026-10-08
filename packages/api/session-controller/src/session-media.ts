/**
 * Session remotes for conversation media. Duck-types `ctx.desktopMedia`.
 * Official session-controller must not import the experimental overlay.
 * @module @deepseek-ai/dsh-api-session-controller/session-media
 */

import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { decodeBase64Payload } from './wire-bytes.ts'
import {
  MEDIA_MAX_DECODED_BYTES,
  type SessionImportMediaBytesRequest,
  type SessionListMediaWorksRequest,
  type SessionMediaRuntimeStatus,
  type SessionMediaVoice,
  type SessionMediaWork,
  type SessionMediaWorkRequest,
  type SessionSaveMediaWorkAsRequest,
} from './types.ts'

/** Host methods the overlay registers as `ctx.desktopMedia`. */
export interface DesktopMediaSeam {
  listWorks(filter: { workspaceId?: string; sessionId?: string }): Promise<readonly SessionMediaWork[]>
  listVoices(): Promise<readonly SessionMediaVoice[]>
  runtimeStatus(signal: AbortSignal): Promise<SessionMediaRuntimeStatus>
  openWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }>
  revealWork(artifactId: string, signal: AbortSignal): Promise<{ requested: true; message: string }>
  copyWorkPath(artifactId: string): Promise<{ path: string }>
  importBytes(
    request: { filename: string; bytes: Uint8Array },
    sessionId: string,
    workspaceId: string | undefined,
  ): Promise<SessionMediaWork>
  saveWorkAs(artifactId: string, destDir: string, filename: string): Promise<{ path: string }>
}

/**
 * Whether a thrown value is the overlay's typed media failure.
 * @param error - thrown value.
 * @returns true when `name` is `MediaError` and `code` is a string.
 */
export function isMediaFailure(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'MediaError'
    && 'code' in error
    && typeof error.code === 'string'
    && 'message' in error
    && typeof error.message === 'string'
}

/**
 * Map one overlay failure onto a RemoteError.
 * @param error - thrown value.
 * @param signal - caller lifetime.
 * @returns never; always throws.
 */
export function mapMediaError(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw new RemoteError('gateway/cancelled', 'media request was aborted', {})
  }
  if (error instanceof RemoteError) throw error
  if (isMediaFailure(error)) {
    throw new RemoteError('session/media-failed', error.message, { code: error.code })
  }
  throw new RemoteError(
    'gateway/internal',
    error instanceof Error ? error.message : String(error),
    {},
  )
}

/**
 * Media Remote helpers owned by Session Controller.
 */
export class SessionMediaController {
  /**
   * @param ctx - Host context.
   */
  constructor(private readonly ctx: Context) {}

  /**
   * Require `ctx.desktopMedia` or fail `session/media-unavailable`.
   * @returns the duck-typed overlay service.
   */
  requireMedia(): DesktopMediaSeam {
    const capability = this.ctx.get('desktopMedia') as DesktopMediaSeam | undefined
    if (capability === undefined) {
      throw new RemoteError(
        'session/media-unavailable',
        'session media remotes need the desktop-media overlay',
        {},
      )
    }
    return capability
  }

  /**
   * List retained works without activating a session.
   * @param request - optional workspace or session filter.
   * @param signal - caller lifetime.
   * @returns catalogue rows.
   */
  async listWorks(
    request: SessionListMediaWorksRequest,
    signal: AbortSignal,
  ): Promise<readonly SessionMediaWork[]> {
    signal.throwIfAborted()
    try {
      return await this.requireMedia().listWorks({
        ...request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId },
        ...request.sessionId === undefined ? {} : { sessionId: request.sessionId },
      })
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * List system and cloned voices.
   * @param signal - caller lifetime.
   * @returns catalogue rows.
   */
  async listVoices(signal: AbortSignal): Promise<readonly SessionMediaVoice[]> {
    signal.throwIfAborted()
    try {
      return await this.requireMedia().listVoices()
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Whether user FFmpeg is recorded and has the V1 encoders.
   * @param signal - caller lifetime.
   * @returns ready flag and install guidance.
   */
  async runtimeStatus(signal: AbortSignal): Promise<SessionMediaRuntimeStatus> {
    signal.throwIfAborted()
    try {
      return await this.requireMedia().runtimeStatus(signal)
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Open a registered work in the system default application.
   * @param request - artifact id.
   * @param signal - caller lifetime.
   * @returns model-safe open wording.
   */
  async openWork(
    request: SessionMediaWorkRequest,
    signal: AbortSignal,
  ): Promise<{ requested: true }> {
    signal.throwIfAborted()
    try {
      await this.requireMedia().openWork(request.artifactId, signal)
      return { requested: true }
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Reveal a registered work in the file manager.
   * @param request - artifact id.
   * @param signal - caller lifetime.
   * @returns model-safe open wording.
   */
  async revealWork(
    request: SessionMediaWorkRequest,
    signal: AbortSignal,
  ): Promise<{ requested: true }> {
    signal.throwIfAborted()
    try {
      await this.requireMedia().revealWork(request.artifactId, signal)
      return { requested: true }
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Copyable absolute path for a registered work.
   * @param request - artifact id.
   * @param signal - caller lifetime.
   * @returns absolute path.
   */
  async copyWorkPath(
    request: SessionMediaWorkRequest,
    signal: AbortSignal,
  ): Promise<{ path: string }> {
    signal.throwIfAborted()
    try {
      return await this.requireMedia().copyWorkPath(request.artifactId)
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Admit selected bytes into managed storage. Does not activate an Agent.
   * @param request - filename, encoded bytes, and owning session.
   * @param signal - caller lifetime.
   * @returns committed work row.
   */
  async importBytes(
    request: SessionImportMediaBytesRequest,
    signal: AbortSignal,
  ): Promise<SessionMediaWork> {
    signal.throwIfAborted()
    const bytes = decodeBase64Payload(request.bytes, {
      limit: MEDIA_MAX_DECODED_BYTES,
      code: 'session/media-failed',
      ruleId: 'file-size',
    })
    try {
      return await this.requireMedia().importBytes(
        { filename: request.filename, bytes },
        request.sessionId,
        request.workspaceId,
      )
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }

  /**
   * Copy a registered work into a user-chosen directory.
   * @param request - artifact, destination directory, and basename.
   * @param signal - caller lifetime.
   * @returns written path.
   */
  async saveWorkAs(
    request: SessionSaveMediaWorkAsRequest,
    signal: AbortSignal,
  ): Promise<{ path: string }> {
    signal.throwIfAborted()
    try {
      return await this.requireMedia().saveWorkAs(
        request.artifactId,
        request.directory,
        request.filename,
      )
    } catch (error: unknown) {
      throw mapMediaError(error, signal)
    }
  }
}
