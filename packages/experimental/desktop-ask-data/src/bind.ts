/**
 * Task 0 adapter: bind through data-agent `DataAgentConnections.connect`.
 * session-controller must not import this file.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/bind
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AskDataConnectionRef, AskDataError,
  type AskDataBindLease, type AskDataBindRequest,
} from '@deepseek-ai/dsh-host-ask-data'
import { assertInsideImport } from './manifest.ts'
import { deleteUnusedProfile, getSavedProfile } from './saved-connections.ts'
import { getStoredSource, putStoredSource } from './sources.ts'

/** Structural face of data-agent 0.1.3 `ctx.dataAgentConnections`. */
export interface DataAgentConnectionsFace {
  get(sessionId: string): DataAgentSummary | undefined
  connect(
    sessionId: string,
    input: {
      type: 'sqlite'
      database: string
      readonly?: boolean
      name?: string
      profileId?: string
    },
    signal: AbortSignal,
  ): Promise<{ summary: DataAgentSummary }>
  disconnect(sessionId: string): Promise<void>
  resolveForExecution(sessionId: string): Promise<{ database: string; readonly?: boolean; profileId?: string }>
}

/** Password-free connection view used for rollback snapshots. */
export interface DataAgentSummary {
  type?: string
  database?: string
  readonly?: boolean
  profileId?: string
  name?: string
}

/**
 * Bind one overlay or saved source to an existing Session via data-agent connect.
 * @param ctx - Host context that may carry `dataAgentConnections`.
 * @param dataHome - resolved data-sources directory.
 * @param request - source and session identities.
 * @param signal - caller lifetime.
 * @returns lease whose rollback restores the pre-call snapshot.
 */
export async function bindSource(
  ctx: Context,
  dataHome: string,
  request: AskDataBindRequest,
  signal?: AbortSignal,
): Promise<AskDataBindLease> {
  const connections = ctx.get('dataAgentConnections') as DataAgentConnectionsFace | undefined
  if (connections === undefined) {
    throw new AskDataError('bind-failed', 'data-agent connections service is not loaded')
  }
  const previous = connections.get(request.sessionId)
  const ac = signal ?? new AbortController().signal
  const saved = getSavedProfile(ctx, request.sourceId)
  if (saved !== undefined) {
    const lease = await bindSaved(connections, request, saved, previous, ac)
    await startCatalogAfterBind(ctx, request.sessionId)
    return lease
  }
  const row = await getStoredSource(dataHome, request.sourceId)
  const already = row.connectionRef !== undefined
    && previous?.profileId === row.connectionRef
  const profileId = row.connectionRef ?? brandString<AskDataConnectionRef>(`ask-data:${row.id}`)
  const createdProfile = row.connectionRef === undefined
  const sqlite = await assertInsideImport(dataHome, row.id, row.sqlitePath)
  const snapshot = { ...row }
  if (!already) {
    await connections.connect(request.sessionId, {
      type: 'sqlite',
      database: sqlite,
      readonly: true,
      name: row.displayName,
      profileId,
    }, ac)
  }
  const lastUsedAt = new Date().toISOString()
  if (!already || row.lastUsedAt === undefined) {
    await putStoredSource(dataHome, { ...row, connectionRef: profileId, lastUsedAt })
  }
  const binding = {
    sourceId: request.sourceId,
    connectionRef: profileId,
    displayName: row.displayName,
    readonly: true,
  }
  await startCatalogAfterBind(ctx, request.sessionId)
  return {
    binding,
    rollback: async () => {
      if (already) return
      await restorePreviousBinding(connections, request.sessionId, previous, ac)
      await putStoredSource(dataHome, snapshot)
      if (createdProfile) await deleteUnusedProfile(ctx, profileId, request.sessionId)
    },
  }
}

/** Structural face of data-agent 0.1.3 `ctx.dataAgentCatalog`. */
interface DataAgentCatalogFace {
  listSources(): readonly { id: string }[]
}

/** Structural face of data-agent 0.1.3 `ctx.dataAgentCatalogScanner`. */
interface DataAgentCatalogScannerFace {
  start(input: { sessionId: string; scope: { kind: 'source' } }): Promise<unknown>
}

/**
 * Register the bound profile in Catalog so the first `catalog-search` does
 * not throw "Catalog is empty". Scan work continues in the background.
 * @param ctx - Host context that may carry the Catalog services.
 * @param sessionId - session that was just bound.
 * @returns after the Catalog source row exists, or immediately on skip/failure.
 */
export async function startCatalogAfterBind(ctx: Context, sessionId: string): Promise<void> {
  const scanner = ctx.get('dataAgentCatalogScanner') as DataAgentCatalogScannerFace | undefined
  if (scanner === undefined) return
  const catalog = ctx.get('dataAgentCatalog') as DataAgentCatalogFace | undefined
  if ((catalog?.listSources().length ?? 0) > 0) return
  try {
    await scanner.start({ sessionId, scope: { kind: 'source' } })
  } catch {
    // Catalog registration is best-effort: sqlite is already bound and SQL still works.
  }
}

async function bindSaved(
  connections: DataAgentConnectionsFace,
  request: AskDataBindRequest,
  saved: { profileId: string; displayName: string; database: string; readonly: boolean },
  previous: DataAgentSummary | undefined,
  ac: AbortSignal,
): Promise<AskDataBindLease> {
  const already = previous?.profileId === saved.profileId
  if (!already) {
    await connections.connect(request.sessionId, {
      type: 'sqlite',
      database: saved.database,
      readonly: saved.readonly,
      name: saved.displayName,
      profileId: saved.profileId,
    }, ac)
  }
  return {
    binding: {
      sourceId: request.sourceId,
      connectionRef: brandString<AskDataConnectionRef>(saved.profileId),
      displayName: saved.displayName,
      readonly: saved.readonly,
    },
    rollback: async () => {
      if (already) return
      await restorePreviousBinding(connections, request.sessionId, previous, ac)
    },
  }
}

async function restorePreviousBinding(
  connections: DataAgentConnectionsFace,
  sessionId: string,
  previous: DataAgentSummary | undefined,
  ac: AbortSignal,
): Promise<void> {
  try {
    if (previous?.type === 'sqlite' && previous.database !== undefined && previous.profileId !== undefined) {
      await connections.connect(sessionId, {
        type: 'sqlite',
        database: previous.database,
        ...previous.readonly === undefined ? {} : { readonly: previous.readonly },
        ...previous.name === undefined ? {} : { name: previous.name },
        profileId: previous.profileId,
      }, ac)
      return
    }
    await connections.disconnect(sessionId)
  } catch {
    // continue restoring the overlay row even if the session binding restore fails
  }
}
