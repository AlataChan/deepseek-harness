/**
 * Helpers for reading persisted session event logs through short-lived read handles.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/persisted
 */

import type { SessionId, SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/** Snapshot view of a persisted session's header and event log. */
export interface PersistedSessionView {
  readonly header: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  readonly events: readonly SessionEvent[]
}

/**
 * Reads a stored session's header and complete event log through a short-lived read handle.
 * @param persistence - session persistence service.
 * @param id - target session identifier.
 * @param signal - optional cancellation signal.
 * @returns stored header and events.
 */
export async function readPersistedSession(
  persistence: SessionPersistence,
  id: SessionId,
  signal?: AbortSignal,
): Promise<PersistedSessionView> {
  const handle = await persistence.open(id, 'read', signal ? { signal } : {})
  try {
    const { events } = await handle.read(0, undefined, signal ? { signal } : {})
    return {
      header: handle.header,
      inheritedEventCount: handle.inheritedEventCount,
      events,
    }
  } finally {
    await handle.close()
  }
}
