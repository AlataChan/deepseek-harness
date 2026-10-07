/**
 * Append and flush media session events before paid work.
 * @module @deepseek-ai/dsh-experimental-desktop-media/journal
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'

type MediaEventType = Extract<keyof SessionEventMap, `media/${string}`>

/** Flush one session after append. */
export type SessionFlush = (session: Session) => Promise<void>

/**
 * Append one media event and await durability when a flush is available.
 * @param agent - live owning agent.
 * @param type - media event type.
 * @param data - event payload.
 * @param flush - optional sessions.flush.
 */
export async function appendMediaEvent<T extends MediaEventType>(
  agent: Agent,
  type: T,
  data: SessionEventMap[T],
  flush?: SessionFlush,
): Promise<void> {
  const append = agent.session.append.bind(agent.session) as (
    eventType: T,
    payload: SessionEventMap[T],
  ) => void
  append(type, data)
  if (flush !== undefined) await flush(agent.session)
}
