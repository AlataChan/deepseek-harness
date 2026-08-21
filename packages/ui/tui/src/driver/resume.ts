/** Bounded session resume discovery. @module @deepseek-ai/dsh-tui/driver/resume */

import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionRecord,
  SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'

/** Minimal session-query methods consumed by the terminal selector. */
export interface ResumeQuery {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<SessionTitleObservationResult[]>
}

/** Immutable session selector row. */
export interface ResumeRow {
  readonly sessionId: SessionId
  readonly title: string
  readonly createdAt: number
  readonly cwd: string | undefined
}

function assertNoCollisions(records: readonly SessionRecord[]): void {
  const ids = new Set<SessionId>()
  for (const record of records) {
    if (ids.has(record.header.id)) {
      throw new Error(`tui resume: session id collision for "${record.header.id}"`)
    }
    ids.add(record.header.id)
  }
}

function fallbackTitle(header: SessionHeader): string {
  return String(header.id)
}

/**
 * Load one bounded immutable selector snapshot.
 * @param query - session query service or compatible test double.
 * @param limit - validated positive maximum row count.
 * @param signal - optional cancellation shared by listing and title reads.
 * @returns newest-first rows with per-title failure fallback.
 */
export async function loadResumeRows(
  query: ResumeQuery,
  limit: number,
  signal?: AbortSignal,
): Promise<readonly ResumeRow[]> {
  const records = await query.listSessions(signal)
  assertNoCollisions(records)
  const selected = [...records]
    .sort((left, right) => right.header.createdAt - left.header.createdAt)
    .slice(0, limit)
  if (selected.length === 0) return Object.freeze([])
  const ids = selected.map(record => record.header.id)
  const titles = await query.readTitleSnapshots(ids, signal)
  const titleById = new Map<SessionId, string>()
  for (const result of titles) {
    if (result.status === 'fulfilled' && result.value.title !== undefined) {
      titleById.set(result.sessionId, result.value.title.title)
    }
  }
  return Object.freeze(selected.map((record): ResumeRow => Object.freeze({
    sessionId: record.header.id,
    title: titleById.get(record.header.id) ?? fallbackTitle(record.header),
    createdAt: record.header.createdAt,
    cwd: record.header.cwd,
  })))
}

/**
 * Prove an exact resume id belongs to the current logical corpus.
 * @param query - session query service.
 * @param sessionId - requested persisted identity.
 * @param signal - optional list cancellation.
 * @returns the matching immutable corpus record.
 */
export async function requireResumeSession(
  query: Pick<ResumeQuery, 'listSessions'>,
  sessionId: SessionId,
  signal?: AbortSignal,
): Promise<SessionRecord> {
  const records = await query.listSessions(signal)
  assertNoCollisions(records)
  const match = records.find(record => record.header.id === sessionId)
  if (match === undefined) throw new Error(`tui resume: session "${sessionId}" not found`)
  return match
}

/**
 * Resolve a selection only from the immutable rows shown to the user.
 * @param rows - closed selector snapshot.
 * @param sessionId - selected id, or undefined when the user cancelled.
 * @returns the selected id or undefined for cancellation.
 */
export function chooseResumeSession(
  rows: readonly ResumeRow[],
  sessionId: SessionId | undefined,
): SessionId | undefined {
  if (sessionId === undefined) return undefined
  if (!rows.some(row => row.sessionId === sessionId)) {
    throw new Error(`tui resume: session "${sessionId}" not found in the selector`)
  }
  return sessionId
}
