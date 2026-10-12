/** Client apply registers the 录音转文字 row once the capabilities slot exists. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  apply,
  inject,
  TranscriptAudioRow,
  transcriptAudioRemotesOf,
} from '../src/client/index.ts'
import type { TranscriptAudioRowInjected } from '../src/client/TranscriptAudioRow.tsx'
import { en, zh } from '../src/client/locales.ts'

interface ListedSession {
  id: string
  workspaceId?: string
}

type RowInject = (sessionId: string | undefined) => TranscriptAudioRowInjected

async function bench(options: {
  byId?: Record<string, ListedSession>
  sessions?: 'full' | 'listless'
  declareSlots?: boolean
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const remotes = {
    importTranscriptAudio: vi.fn(async () => ({
      ok: true as const,
      value: { path: 'recordings/a.m4a', filename: 'a.m4a' },
    })),
  }
  // Remote namespaces are separate services (`remote.<name>`).
  ctx.provide('remote', { session: remotes } as never)
  ctx.provide('remote.session', remotes)
  ctx.provide('conversation', {})
  const state = { byId: options.byId ?? {} }
  ctx.provide('sessions', options.sessions === 'listless' ? {} : { list: { getSnapshot: () => state } })
  ctx.provide('uiWorkspace', {})
  const slots = ctx.get('slots') as SlotRegistry
  const declareSlots = (): void => {
    slots.register({
      name: 'root',
      children: {
        'conversation.hero.capabilities.item': { kind: 'list', scope: 'session-maybe' },
      },
    } as never, () => null)
  }
  if (options.declareSlots !== false) declareSlots()
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, remotes, declareSlots, dispose: () => fiber.dispose() }
}

function rowInject(slots: SlotRegistry): RowInject {
  const entry = slots.entries('conversation.hero.capabilities.item')
    .find(row => row.options.id === 'desktop-speech-transcribe')
  if (entry === undefined) throw new Error('the row was not registered')
  // The stored inject face is type-erased (`...args: never[]`); the test knows
  // the positional contract its own registration declared.
  return entry.inject as never
}

describe('desktop-speech-transcribe client apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.session', 'locale'])
  })

  it('registers the row when the slot declaration arrives after apply', async () => {
    const b = await bench({ declareSlots: false })
    expect(b.slots.entries('conversation.hero.capabilities.item')).toHaveLength(0)
    b.declareSlots()
    expect(b.slots.entries('conversation.hero.capabilities.item').map(row => row.options.id))
      .toEqual(['desktop-speech-transcribe'])
    await b.dispose()
    expect(b.slots.entries('conversation.hero.capabilities.item')).toHaveLength(0)
  })

  it('registers the row with its order, locale, and inject face', async () => {
    const b = await bench({ byId: { 's-1': { id: 's-1', workspaceId: 'w-1' } } })
    const entry = b.slots.entries('conversation.hero.capabilities.item')[0]
    expect(entry?.options.order).toBe(35)
    expect(entry?.locale).toBe('desktop-speech-transcribe')
    expect(entry?.component).toBe(TranscriptAudioRow)
    expect(rowInject(b.slots)('s-1')).toEqual({
      remotes: b.remotes,
      sessionId: 's-1',
      workspaceId: 'w-1',
    })
    expect(transcriptAudioRemotesOf(b.ctx)).toBe(b.remotes)
    expect(zh['row.label']).toBe('录音转文字')
    expect(en['row.label']).toBe('Transcribe recording')
    await b.dispose()
  })

  it('injects a session without a workspace and no session at all', async () => {
    const b = await bench({ byId: { 's-2': { id: 's-2' } } })
    expect(rowInject(b.slots)('s-2')).toEqual({ remotes: b.remotes, sessionId: 's-2' })
    expect(rowInject(b.slots)(undefined)).toEqual({ remotes: b.remotes })
    await b.dispose()
  })

  it('omits the workspace id when the sessions list is absent', async () => {
    const b = await bench({ sessions: 'listless', byId: { 's-3': { id: 's-3', workspaceId: 'w-3' } } })
    expect(rowInject(b.slots)('s-3')).toEqual({ remotes: b.remotes, sessionId: 's-3' })
    await b.dispose()
  })
})
