/**
 * Live data-agent profiles that are not overlay-managed rows.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/saved-connections
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  AskDataConnectionRef, AskDataSourceId,
  type AskDataSource,
} from '@deepseek-ai/dsh-host-ask-data'

/** Password-free durable profile row used only for listing unmatched connections. */
export interface SavedConnectionProfile {
  readonly profileId: string
  readonly displayName: string
  readonly database: string
  readonly readonly: boolean
  readonly updatedAt?: string
}

/** Structural face of an already-open `data_agent_connections` domain. */
interface OpenConnectionDomain {
  table(name: string): {
    entries(): IterableIterator<[string, {
      name?: string
      type?: string
      database: string
      readonly?: boolean
      updatedAt?: string
    }]>
    delete(id: string): Promise<boolean>
  }
}

/**
 * Stable list id for one unmatched data-agent profile.
 * @param profileId - durable profile id.
 * @returns branded source id.
 */
export function savedSourceId(profileId: string): AskDataSourceId {
  return brandString<AskDataSourceId>(`saved:${profileId}`)
}

/**
 * Profile id encoded in a `saved:` source id.
 * @param sourceId - listed source id.
 * @returns profile id, or undefined when the id is not a saved row.
 */
export function profileIdFromSavedSource(sourceId: string): string | undefined {
  return sourceId.startsWith('saved:') ? sourceId.slice('saved:'.length) : undefined
}

/**
 * List data-agent profiles that no overlay row already names.
 * @param ctx - Host context that may already have the connections domain open.
 * @param overlayRefs - connection refs owned by overlay rows.
 * @returns saved-kind list rows.
 */
export function listUnmatchedSaved(
  ctx: Context,
  overlayRefs: ReadonlySet<string>,
): AskDataSource[] {
  const rows: AskDataSource[] = []
  for (const profile of listSavedProfiles(ctx)) {
    if (overlayRefs.has(profile.profileId)) continue
    rows.push({
      id: savedSourceId(profile.profileId),
      displayName: profile.displayName,
      kind: 'saved',
      connectionRef: brandString<AskDataConnectionRef>(profile.profileId),
      ...profile.updatedAt === undefined ? {} : { lastUsedAt: profile.updatedAt },
      warnings: [],
      missing: false,
    })
  }
  return rows
}

/**
 * Resolve one unmatched saved profile.
 * @param ctx - Host context.
 * @param sourceId - listed `saved:` id.
 * @returns the profile, or undefined when absent.
 */
export function getSavedProfile(ctx: Context, sourceId: string): SavedConnectionProfile | undefined {
  const profileId = profileIdFromSavedSource(sourceId)
  if (profileId === undefined) return undefined
  return listSavedProfiles(ctx).find(row => row.profileId === profileId)
}

/**
 * Delete a profile this bind created, only when no remaining binding owns it.
 * @param ctx - Host context.
 * @param profileId - durable profile id.
 * @param keepSessionId - session whose binding was just restored; ignored as an owner.
 * @returns after the optional delete.
 */
export async function deleteUnusedProfile(
  ctx: Context,
  profileId: string,
  keepSessionId: string,
): Promise<void> {
  const domain = openConnectionsDomain(ctx)
  if (domain === undefined) return
  try {
    for (const [sessionId, binding] of domain.table('bindings').entries()) {
      if (sessionId === keepSessionId) continue
      if ((binding as { profileId?: string }).profileId === profileId) return
    }
    await domain.table('profiles').delete(profileId)
  } catch {
    // 0.1.3 Host service has no deleteProfile; domain delete is best-effort
  }
}

function listSavedProfiles(ctx: Context): SavedConnectionProfile[] {
  const domain = openConnectionsDomain(ctx)
  if (domain === undefined) return []
  const rows: SavedConnectionProfile[] = []
  try {
    for (const [profileId, profile] of domain.table('profiles').entries()) {
      rows.push({
        profileId,
        displayName: profile.name ?? basename(profile.database),
        database: profile.database,
        readonly: profile.readonly === true,
        ...profile.updatedAt === undefined ? {} : { updatedAt: profile.updatedAt },
      })
    }
  } catch {
    return []
  }
  return rows
}

function openConnectionsDomain(ctx: Context): OpenConnectionDomain | undefined {
  const facility = ctx.get('storageDomain') as { get?(name: string): OpenConnectionDomain | undefined } | undefined
  return facility?.get?.('data_agent_connections')
}
