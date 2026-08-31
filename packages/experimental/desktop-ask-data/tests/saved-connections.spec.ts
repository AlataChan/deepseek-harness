/** Unmatched data-agent profiles appear as saved sources. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  deleteUnusedProfile, getSavedProfile, listUnmatchedSaved, savedSourceId,
} from '../src/saved-connections.ts'

type ProfileRow = {
  database: string
  name?: string
  readonly?: boolean
  updatedAt?: string
}

function domain(
  profiles: Map<string, ProfileRow>,
  bindings: Map<string, { profileId: string }> = new Map(),
) {
  return {
    table(name: string) {
      if (name === 'profiles') {
        return {
          entries: () => profiles.entries(),
          delete: async (id: string) => profiles.delete(id),
        }
      }
      return {
        entries: () => bindings.entries(),
        delete: async () => false,
      }
    },
  }
}

describe('saved connections', () => {
  it('lists unmatched profiles and skips overlay-owned refs', () => {
    const ctx = new Context()
    ctx.provide('storageDomain', {
      get: () => domain(new Map([
        ['owned', { database: '/a.sqlite', name: 'owned', readonly: true }],
        ['extra', { database: '/b.sqlite', name: 'extra', readonly: false }],
      ])),
    })
    const listed = listUnmatchedSaved(ctx, new Set(['owned']))
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(savedSourceId('extra'))
    expect(listed[0]?.kind).toBe('saved')
    expect(getSavedProfile(ctx, savedSourceId('extra'))?.database).toBe('/b.sqlite')
  })

  it('does not delete a profile another session still owns', async () => {
    const ctx = new Context()
    const profiles = new Map([['p1', { database: '/a.sqlite' }]])
    ctx.provide('storageDomain', {
      get: () => domain(profiles, new Map([['s2', { profileId: 'p1' }]])),
    })
    await deleteUnusedProfile(ctx, 'p1', 's1')
    expect(profiles.has('p1')).toBe(true)
  })

  it('deletes a profile when another session owns a different one', async () => {
    const ctx = new Context()
    const profiles = new Map([['p1', { database: '/a.sqlite' }]])
    ctx.provide('storageDomain', {
      get: () => domain(profiles, new Map([['s2', { profileId: 'other' }]])),
    })
    await deleteUnusedProfile(ctx, 'p1', 's1')
    expect(profiles.has('p1')).toBe(false)
  })

  it('deletes a profile with no remaining owner', async () => {
    const ctx = new Context()
    const profiles = new Map([['p1', { database: '/a.sqlite' }]])
    ctx.provide('storageDomain', {
      get: () => domain(profiles, new Map([['s1', { profileId: 'p1' }]])),
    })
    await deleteUnusedProfile(ctx, 'p1', 's1')
    expect(profiles.has('p1')).toBe(false)
  })

  it('returns nothing when the connections domain is closed', async () => {
    const ctx = new Context()
    expect(listUnmatchedSaved(ctx, new Set())).toEqual([])
    expect(getSavedProfile(ctx, 'src-1')).toBeUndefined()
    await expect(deleteUnusedProfile(ctx, 'p1', 's1')).resolves.toBeUndefined()
  })

  it('uses the database basename when a profile has no name', () => {
    const ctx = new Context()
    ctx.provide('storageDomain', {
      get: () => domain(new Map([
        ['p2', { database: '/tmp/sales.sqlite', updatedAt: '2026-03-01T00:00:00.000Z' }],
      ])),
    })
    const listed = listUnmatchedSaved(ctx, new Set())
    expect(listed[0]?.displayName).toBe('sales.sqlite')
    expect(listed[0]?.lastUsedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('swallows a domain that throws while listing or deleting', async () => {
    const ctx = new Context()
    ctx.provide('storageDomain', {
      get: () => ({
        table: () => ({
          entries: () => { throw new Error('domain closed') },
          delete: async () => { throw new Error('no delete') },
        }),
      }),
    })
    expect(listUnmatchedSaved(ctx, new Set())).toEqual([])
    await expect(deleteUnusedProfile(ctx, 'p1', 's1')).resolves.toBeUndefined()
  })
})
