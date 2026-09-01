/**
 * Live and cold unbind of sessions that hang one library.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/unbind
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'

/**
 * Fold the latest ask-knowledge bind from a log.
 * @param events - session events.
 * @returns current bind, or null.
 */
export function foldAskKnowledgeBinding(
  events: readonly { readonly type: string; readonly data: unknown }[],
): { libraryId: string; displayName: string } | null {
  let binding: { libraryId: string; displayName: string } | null = null
  for (const event of events) {
    if (event.type === 'ask-knowledge/bound' && isBinding(event.data)) binding = event.data
    if (event.type === 'ask-knowledge/unbound') binding = null
  }
  return binding
}

/**
 * Session ids currently bound to `libraryId` (live first, then cold).
 * @param ctx - Host context.
 * @param libraryId - catalog id.
 * @returns bound identities.
 */
export async function listBoundSessionIds(
  ctx: Context,
  libraryId: AskKnowledgeLibraryId,
): Promise<SessionId[]> {
  const ids = new Set<string>()
  const sessions = ctx.get('sessions')
  if (sessions !== undefined) {
    for (const session of sessions.list()) {
      const binding = ctx.get('sessionProjections')?.stateOf(session, 'askKnowledgeBinding')
        ?? foldAskKnowledgeBinding(session.events)
      if (binding?.libraryId === libraryId) ids.add(session.id)
    }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence !== undefined) {
    const headers = await persistence.list()
    for (const header of headers) {
      if (ids.has(header.id)) continue
      if (sessions?.get(header.id) !== undefined) continue
      const loaded = await persistence.load(header.id)
      const binding = foldAskKnowledgeBinding(loaded.events)
      if (binding?.libraryId === libraryId) ids.add(header.id)
    }
  }
  return [...ids] as SessionId[]
}

/**
 * Append unbound on a live Session or, after a live re-check, on persistence.
 * Caller must already hold that session mutex.
 * @param ctx - Host context.
 * @param sessionId - identity.
 * @param libraryId - library being removed or detached.
 */
export async function unbindSession(
  ctx: Context,
  sessionId: SessionId,
  libraryId: AskKnowledgeLibraryId,
): Promise<void> {
  const live = ctx.get('sessions')?.get(sessionId)
  if (live !== undefined) {
    appendUnbound(live, libraryId)
    return
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) return
  const raced = ctx.get('sessions')?.get(sessionId)
  if (raced !== undefined) {
    appendUnbound(raced, libraryId)
    return
  }
  const loaded = await persistence.load(sessionId)
  const stillLive = ctx.get('sessions')?.get(sessionId)
  if (stillLive !== undefined) {
    appendUnbound(stillLive, libraryId)
    return
  }
  const last = loaded.events.at(-1)
  const seq = last === undefined ? 0 : last.seq + 1
  const event = {
    type: 'ask-knowledge/unbound',
    seq,
    time: Date.now(),
    data: { libraryId },
  } as SessionEvent
  await persistence.append(sessionId, [event])
}

function appendUnbound(session: Session, libraryId: AskKnowledgeLibraryId): void {
  session.append('ask-knowledge/unbound', { libraryId })
}

function isBinding(value: unknown): value is { libraryId: string; displayName: string } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { libraryId?: unknown; displayName?: unknown }
  return typeof record.libraryId === 'string' && typeof record.displayName === 'string'
}

/**
 * Refuse persistence.append when the id is live.
 * @param ctx - Host context.
 * @param sessionId - identity.
 */
export function assertNotLiveForPersistence(ctx: Context, sessionId: SessionId): void {
  if (ctx.get('sessions')?.get(sessionId) !== undefined) {
    throw new AskKnowledgeError('session-busy', `session ${sessionId} is live; use Session.append`)
  }
}
