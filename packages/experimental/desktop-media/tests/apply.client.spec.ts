/** Client apply registers dictionaries, shortcuts, cards, and Works. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  apply,
  CreationShortcuts,
  inject,
  MediaCard,
  mediaCredentialsOf,
  mediaRemotesOf,
  MinimaxKeyCard,
  MINIMAX_API_KEY_NAME,
  nativePickDirectory,
  WorksButton,
} from '../src/client/index.ts'
import type { MediaCardInjected } from '../src/client/MediaCard.tsx'
import type { WorksPanelInjected } from '../src/client/WorksPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

interface ListedSession {
  id: string
  workspaceId?: string
}

async function bench(options: {
  current?: string
  byId?: Record<string, ListedSession>
  sessions?: boolean
  pickDirectory?: () => Promise<string | null>
  credentials?: { describe: () => Promise<unknown>; set: () => Promise<unknown> }
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remotes = {
    listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [] })),
    mediaRuntimeStatus: vi.fn(async () => ({ ok: true as const, value: { ready: true, guidance: '' } })),
    openMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    revealMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    copyMediaWorkPath: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/a.mp4' } })),
    listMediaVoices: vi.fn(async () => ({ ok: true as const, value: [] })),
    importMediaBytes: vi.fn(async () => ({ ok: true as const, value: { artifactId: 'a_1' } })),
    saveMediaWorkAs: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/out.mp4' } })),
  }
  ctx.provide('remote', {
    session: remotes,
    ...options.credentials === undefined ? {} : { credentials: options.credentials },
  } as never)
  ctx.provide('remote.session', remotes)
  const state = {
    current: options.current,
    byId: options.byId ?? {},
  }
  const open = vi.fn()
  if (options.sessions !== false) {
    ctx.provide('sessions', {
      list: { getSnapshot: () => state },
      open,
    })
  }
  if (options.pickDirectory !== undefined) {
    ctx.provide('uiWorkspace', { pickDirectory: options.pickDirectory })
  }
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.directoryFlow': { kind: 'list', scope: 'root' },
      'settings.models.footer': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, remotes, open, state, dispose: () => fiber.dispose() }
}

describe('desktop-media client apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('registers dictionaries, shortcuts, keyed cards, and Works', async () => {
    const b = await bench({
      current: 's-1',
      byId: { 's-1': { id: 's-1', workspaceId: 'w-1' } },
      pickDirectory: async () => '/tmp',
    })
    expect(b.slots.entries('conversation.input.left')[0]?.component).toBe(CreationShortcuts)
    const shortcuts = (b.slots.entries('conversation.input.left')[0]!.inject as unknown as (
      sessionId: string,
    ) => { remotes: unknown; sessionId: string; workspaceId?: string })('s-1')
    expect(shortcuts.remotes).toBe(b.remotes)
    expect(shortcuts.sessionId).toBe('s-1')
    expect(shortcuts.workspaceId).toBe('w-1')
    expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(WorksButton)
    expect(b.slots.entries('settings.models.footer')[0]?.component).toBe(MinimaxKeyCard)
    expect(b.slots.entries('shell.overlay').map(row => row.options.id)).toEqual([
      'desktop-media-works-panel',
    ])
    expect(b.slots.entries('tool.call.toolview').map(row => row.options.key)).toEqual([
      'media_create_video',
      'media_synthesize_speech',
      'media_clone_voice',
      'media_compose',
    ])
    expect(b.slots.entries('tool.call.toolview').every(row => row.component === MediaCard)).toBe(true)
    expect(mediaRemotesOf(b.ctx)).toBe(b.remotes)
    const card = (b.slots.entries('tool.call.toolview')[0]!.inject as unknown as () => MediaCardInjected)()
    expect(card.sessionId).toBe('s-1')
    expect(card.workspaceId).toBe('w-1')
    expect(card.remotes).toBe(b.remotes)
    const panel = (b.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    expect(panel.current?.id).toBe('s-1')
    panel.openSession('s-1')
    expect(b.open).toHaveBeenCalled()
    await panel.pickDirectory?.()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    })
    await panel.copyText?.('path')
    expect(writeText).toHaveBeenCalledWith('path')
    expect(zh['works.button']).toBe('作品')
    expect(en['works.button']).toBe('Works')
    expect(zh['settings.title']).toBe('MiniMax')
    expect(MINIMAX_API_KEY_NAME).toBe('MINIMAX_API_KEY')
    expect(mediaCredentialsOf(b.ctx)).toBeUndefined()
    const footer = (b.slots.entries('settings.models.footer')[0]!.inject as unknown as () => {
      credentials?: unknown
    })()
    expect(footer.credentials).toBeUndefined()
    await b.dispose()
  })

  it('passes credentials remotes into the Models footer card', async () => {
    const credentials = {
      describe: vi.fn(async () => ({ ok: true as const, value: {} })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const b = await bench({ credentials })
    expect(mediaCredentialsOf(b.ctx)).toBe(credentials)
    const footer = (b.slots.entries('settings.models.footer')[0]!.inject as unknown as () => {
      credentials?: typeof credentials
    })()
    expect(footer.credentials).toBe(credentials)
    await b.dispose()
  })

  it('omits session and Save As when those services are absent', async () => {
    const b = await bench({ sessions: false })
    const card = (b.slots.entries('tool.call.toolview')[0]!.inject as unknown as () => MediaCardInjected)()
    expect(card.sessionId).toBe('')
    expect(card.workspaceId).toBeUndefined()
    const panel = (b.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    expect(panel.current).toBeUndefined()
    expect(panel.pickDirectory).toBeUndefined()
    panel.openSession('s-1')
    await b.dispose()
  })

  it('injects a current session without a workspace', async () => {
    const b = await bench({
      current: 's-2',
      byId: { 's-2': { id: 's-2' } },
    })
    const card = (b.slots.entries('tool.call.toolview')[0]!.inject as unknown as () => MediaCardInjected)()
    expect(card.sessionId).toBe('s-2')
    expect(card.workspaceId).toBeUndefined()
    const panel = (b.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    expect(panel.current?.id).toBe('s-2')
    await b.dispose()
  })

  it('treats an unknown current id as no current session', async () => {
    const b = await bench({ current: 'missing', byId: {} })
    const card = (b.slots.entries('tool.call.toolview')[0]!.inject as unknown as () => MediaCardInjected)()
    expect(card.sessionId).toBe('')
    const panel = (b.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    expect(panel.current).toBeUndefined()
    await b.dispose()
  })

  it('passes native pickDirectory into Works and hides browse', async () => {
    const pick = vi.fn(async () => '/tmp')
    const native = await bench({
      current: 's-1',
      byId: { 's-1': { id: 's-1' } },
      pickDirectory: pick,
    })
    native.slots.register({
      name: 'sidebar.workspaces.directoryFlow',
      id: 'desktop-media-test-native',
      inject: () => ({ pick }),
    } as never, () => null)
    const nativePanel = (native.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    await nativePanel.pickDirectory?.()
    expect(pick).toHaveBeenCalled()
    await native.dispose()

    const browse = await bench({ pickDirectory: pick })
    browse.slots.register({
      name: 'sidebar.workspaces.directoryFlow',
      id: 'desktop-media-test-browse',
      inject: () => ({ listDirectory: async () => [] }),
    } as never, () => null)
    const browsePanel = (browse.slots.entries('shell.overlay')[0]!.inject as unknown as () => WorksPanelInjected)()
    expect(browsePanel.pickDirectory).toBeUndefined()
    await browse.dispose()
  })
})

describe('mediaCredentialsOf', () => {
  it('requires both describe and set on remote.credentials', () => {
    expect(mediaCredentialsOf({} as never)).toBeUndefined()
    expect(mediaCredentialsOf({ remote: {} } as never)).toBeUndefined()
    expect(mediaCredentialsOf({ remote: { credentials: { describe: async () => ({}) } } } as never))
      .toBeUndefined()
    expect(mediaCredentialsOf({ remote: { credentials: { set: async () => ({}) } } } as never))
      .toBeUndefined()
  })
})

describe('nativePickDirectory', () => {
  const pick = async () => '/tmp'

  function fake(options: {
    pickDirectory?: () => Promise<string | null>
    slots?: { entries: (name: string) => readonly { inject?: () => Record<string, unknown> | undefined }[] }
  }): Context {
    return {
      get(name: string) {
        if (name === 'uiWorkspace') {
          return options.pickDirectory === undefined ? undefined : { pickDirectory: options.pickDirectory }
        }
        if (name === 'slots') return options.slots
        return undefined
      },
    } as Context
  }

  it('hides Save As unless a native directory-flow occupant is present', async () => {
    expect(nativePickDirectory(fake({}))).toBeUndefined()
    expect(nativePickDirectory(fake({ pickDirectory: pick }))).toBeUndefined()
    expect(nativePickDirectory(fake({
      pickDirectory: pick,
      slots: { entries: () => { throw new Error('no hole') } },
    }))).toBeUndefined()
    expect(nativePickDirectory(fake({
      pickDirectory: pick,
      slots: { entries: () => [{}, { inject: undefined }, { inject: () => undefined }, { inject: () => ({}) }] },
    }))).toBeUndefined()
    expect(nativePickDirectory(fake({
      pickDirectory: pick,
      slots: { entries: () => [{ inject: () => ({ listDirectory: async () => [] }) }] },
    }))).toBeUndefined()
    const native = nativePickDirectory(fake({
      pickDirectory: pick,
      slots: { entries: () => [{ inject: () => ({ pick }) }] },
    }))
    await expect(native?.()).resolves.toBe('/tmp')
  })
})
