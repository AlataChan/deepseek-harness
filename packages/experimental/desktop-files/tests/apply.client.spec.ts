/** File-tree occupant registers through slots.inject after the sidebar hole exists. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { FileTreeInjected } from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listEntries = vi.fn(async () => ({
    ok: true as const,
    value: { path: '/tmp', root: '/tmp', entries: [], truncated: false },
  }))
  const openWorkspacePath = vi.fn(async () => ({ ok: true as const, value: { opened: true as const } }))
  ctx.provide('remote', { session: { listEntries, openWorkspacePath } } as never)
  ctx.provide('remote.session', { listEntries, openWorkspacePath } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    { name: 'root', children: { sidebar: { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  slots.register(
    { name: 'sidebar', children: { 'sidebar.files': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  return { ctx, slots, listEntries, openWorkspacePath }
}

describe('desktop-files apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('injects the tree into sidebar.files and wraps Session remotes', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.files')).toHaveLength(1)
    const injected = (b.slots.entries('sidebar.files')[0]!.inject as unknown as () => FileTreeInjected)()
    await injected.listEntries('s1' as never, '/proj')
    expect(b.listEntries).toHaveBeenCalledWith(
      { sessionId: 's1', path: '/proj' },
      undefined,
    )
    await injected.openPath('/proj/a.ts')
    expect(b.openWorkspacePath).toHaveBeenCalledWith({ path: '/proj/a.ts' })
  })
})
