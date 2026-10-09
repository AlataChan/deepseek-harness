/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { CreationShortcuts, fileFromPicker } from '../src/client/CreationShortcuts.tsx'
import type { CreationShortcutsProps } from '../src/client/CreationShortcuts.tsx'
import { zh } from '../src/client/locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MediaCredentialsRemotes, MediaSessionRemotes } from '../src/client/remotes.ts'

const t: TranslateNS<'desktop-media'> = key => (
  key in zh ? zh[key as keyof typeof zh] : key
)

function credentials(configured: boolean): MediaCredentialsRemotes {
  return {
    describe: vi.fn(async (refs: string[]) => ({
      ok: true as const,
      value: Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }])),
    })),
    set: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
}

function remotes(overrides: Partial<MediaSessionRemotes> = {}): MediaSessionRemotes {
  return {
    listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [] })),
    mediaRuntimeStatus: vi.fn(async () => ({ ok: true as const, value: { ready: true, guidance: '' } })),
    openMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    revealMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    copyMediaWorkPath: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/a.mp3' } })),
    listMediaVoices: vi.fn(async () => ({ ok: true as const, value: [] })),
    importMediaBytes: vi.fn(async () => ({
      ok: true as const,
      value: {
        artifactId: 'a_voice',
        requestId: 'r_1',
        kind: 'import' as const,
        name: 'sample.mp3',
        sessionId: 's-1',
        createdAt: '2026-09-20T00:00:00.000Z',
      },
    })),
    saveMediaWorkAs: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/out.mp4' } })),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('CreationShortcuts', () => {
  it('loads methods into the draft and submits', async () => {
    const inputActions = {
      setDraft: vi.fn(),
      submit: vi.fn(),
      addAttachments: vi.fn(),
      removeAttachment: vi.fn(),
      pruneAttachments: vi.fn(),
    }
    const view = render(
      // Unread framework session seats are filled by the cast.
      <CreationShortcuts {...({
        inputActions,
        close: () => {},
        remotes: remotes(),
        credentials: credentials(true),
        t,
      } as CreationShortcutsProps)} />,
    )
    fireEvent.click(view.getByRole('menuitem', { name: '做视频' }))
    await waitFor(() => {
      expect(inputActions.setDraft).toHaveBeenCalledWith(zh['prompt.video'])
    })
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByRole('menuitem', { name: '做配音' }))
    await waitFor(() => {
      expect(inputActions.setDraft).toHaveBeenCalledWith(zh['prompt.speech'])
    })
    expect(inputActions.submit).toHaveBeenCalledTimes(2)
  })

  it('opens the system file control and imports a chosen recording', async () => {
    const inputActions = {
      setDraft: vi.fn(),
      submit: vi.fn(),
      addAttachments: vi.fn(),
      removeAttachment: vi.fn(),
      pruneAttachments: vi.fn(),
    }
    const api = remotes()
    const view = render(
      <CreationShortcuts {...({
        inputActions,
        close: () => {},
        remotes: api,
        credentials: credentials(true),
        sessionId: SessionId('s-1'),
        t,
      } as CreationShortcutsProps)} />,
    )
    const picker = view.getByLabelText('克隆声音')
    expect(picker.tagName).toBe('INPUT')
    expect(picker).toHaveProperty('type', 'file')
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3')
    fireEvent.change(picker, { target: { files: [file] } })
    await waitFor(() => {
      expect(view.getByRole('dialog', { name: '克隆声音' })).toBeTruthy()
    })
    expect(view.getByText('sample.mp3')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '确认克隆' }))
    expect(api.importMediaBytes).not.toHaveBeenCalled()
    fireEvent.click(view.getAllByRole('checkbox')[0]!)
    fireEvent.click(view.getByRole('button', { name: '确认克隆' }))
    await waitFor(() => {
      expect(api.importMediaBytes).toHaveBeenCalledWith({
        filename: 'sample.mp3',
        bytes: expect.any(String),
        sessionId: 's-1',
      })
      expect(inputActions.setDraft).toHaveBeenCalledWith(expect.stringContaining('a_voice'))
      expect(inputActions.submit).toHaveBeenCalled()
    })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('rejects a non-audio pick and an empty picker event', async () => {
    const input = document.createElement('input')
    expect(fileFromPicker({ target: input } as never)).toBeUndefined()
    const view = render(
      <CreationShortcuts {...({
        inputActions: {
          setDraft: vi.fn(),
          submit: vi.fn(),
          addAttachments: vi.fn(),
          removeAttachment: vi.fn(),
          pruneAttachments: vi.fn(),
        },
        close: () => {},
        remotes: remotes(),
        credentials: credentials(true),
        sessionId: SessionId('s-1'),
        t,
      } as CreationShortcutsProps)} />,
    )
    fireEvent.change(view.getByLabelText('克隆声音'), {
      target: { files: [new File([new Uint8Array([1])], 'notes.txt')] },
    })
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toBe(zh['voice.badFile'])
    })
  })

  it('asks for the MiniMax key before sending a shortcut', async () => {
    const inputActions = {
      setDraft: vi.fn(),
      submit: vi.fn(),
      addAttachments: vi.fn(),
      removeAttachment: vi.fn(),
      pruneAttachments: vi.fn(),
    }
    const view = render(
      <CreationShortcuts {...({
        inputActions,
        close: () => {},
        remotes: remotes(),
        credentials: credentials(false),
        t,
      } as CreationShortcutsProps)} />,
    )
    fireEvent.click(view.getByRole('menuitem', { name: '做视频' }))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toBe(zh['preflight.keyMissing'])
    })
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
  })
})
