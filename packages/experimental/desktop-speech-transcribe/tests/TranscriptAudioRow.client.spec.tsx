/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  MAX_UPLOAD_MIB,
  TranscriptAudioRow,
  encodeAudioBytes,
  fileFromPicker,
  readAudioFile,
} from '../src/client/TranscriptAudioRow.tsx'
import type { TranscriptAudioRowProps } from '../src/client/TranscriptAudioRow.tsx'
import { zh } from '../src/client/locales.ts'
import type { TranscriptAudioRemotes } from '../src/client/remotes.ts'

const t: TranslateNS<'desktop-speech-transcribe'> = (key, params) => {
  let text: string = key in zh ? zh[key as keyof typeof zh] : key
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function actions() {
  return {
    setDraft: vi.fn(),
    submit: vi.fn(),
    addAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
  }
}

function remotes(overrides: Partial<TranscriptAudioRemotes> = {}): TranscriptAudioRemotes {
  return {
    importTranscriptAudio: vi.fn(async () => ({
      ok: true as const,
      value: { path: 'recordings/meeting.m4a', filename: 'meeting.m4a' },
    })),
    ...overrides,
  }
}

function view(props: Record<string, unknown>) {
  return render(<TranscriptAudioRow {...({ close: () => {}, t, ...props } as TranscriptAudioRowProps)} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TranscriptAudioRow', () => {
  it('renders the row and opens its hidden file control', () => {
    const rendered = view({ inputActions: actions(), remotes: remotes(), sessionId: SessionId('s-1') })
    expect(rendered.getByRole('menuitem', { name: '录音转文字' })).toBeTruthy()
    const picker = rendered.getByLabelText('录音转文字') as HTMLInputElement
    expect(picker.type).toBe('file')
    expect(picker.accept).toBe('audio/*,.m4a,.mp3,.wav,.aac')
    const click = vi.spyOn(picker, 'click')
    fireEvent.click(rendered.getByRole('menuitem', { name: '录音转文字' }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('stages a chosen recording, fills the draft, submits, and closes the menu', async () => {
    const inputActions = actions()
    const close = vi.fn()
    const api = remotes()
    const rendered = view({
      inputActions, close, remotes: api, sessionId: SessionId('s-1'), workspaceId: 'w-1',
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'meeting.m4a')
    fireEvent.change(rendered.getByLabelText('录音转文字'), { target: { files: [file] } })

    await waitFor(() => { expect(api.importTranscriptAudio).toHaveBeenCalledTimes(1) })
    expect(api.importTranscriptAudio).toHaveBeenCalledWith({
      filename: 'meeting.m4a',
      bytes: encodeAudioBytes(new Uint8Array([1, 2, 3])),
      sessionId: 's-1',
      workspaceId: 'w-1',
    })
    await waitFor(() => {
      expect(inputActions.setDraft).toHaveBeenCalledWith('把 recordings/meeting.m4a 转成文字稿')
    })
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(rendered.queryByRole('alert')).toBeNull()
  })

  it('stages without a workspace when the session carries none', async () => {
    const inputActions = actions()
    const api = remotes()
    const rendered = view({ inputActions, remotes: api, sessionId: SessionId('s-1') })
    fireEvent.change(rendered.getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([7])], 'note.wav')] },
    })
    await waitFor(() => { expect(api.importTranscriptAudio).toHaveBeenCalledTimes(1) })
    expect(api.importTranscriptAudio).toHaveBeenCalledWith({
      filename: 'note.wav',
      bytes: encodeAudioBytes(new Uint8Array([7])),
      sessionId: 's-1',
    })
  })

  it('ignores an empty picker selection', () => {
    const api = remotes()
    const rendered = view({ inputActions: actions(), remotes: api, sessionId: SessionId('s-1') })
    fireEvent.change(rendered.getByLabelText('录音转文字'), { target: { files: [] } })
    expect(api.importTranscriptAudio).not.toHaveBeenCalled()
  })

  it('asks for a session before staging', async () => {
    const api = remotes()
    const rendered = view({ remotes: api })
    fireEvent.change(rendered.getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'a.m4a')] },
    })
    await waitFor(() => { expect(rendered.getByRole('alert').textContent).toBe(zh['row.noSession']) })
    expect(api.importTranscriptAudio).not.toHaveBeenCalled()
  })

  it('reports missing remotes and a missing session', async () => {
    const withoutRemotes = view({ inputActions: actions() })
    fireEvent.change(within(withoutRemotes.container).getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'a.m4a')] },
    })
    await waitFor(() => { expect(within(withoutRemotes.container).getByRole('alert').textContent).toBe(zh['row.unavailable']) })

    const withoutSession = view({ inputActions: actions(), remotes: remotes() })
    fireEvent.change(within(withoutSession.container).getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'b.m4a')] },
    })
    await waitFor(() => { expect(within(withoutSession.container).getByRole('alert').textContent).toBe(zh['row.unavailable']) })
  })

  it('reports a recording over the upload cap before it reaches the remote', async () => {
    const api = remotes()
    const rendered = view({ inputActions: actions(), remotes: api, sessionId: SessionId('s-1') })
    const large = new File([new Uint8Array(0)], 'long.m4a')
    Object.defineProperty(large, 'arrayBuffer', {
      value: async () => new ArrayBuffer(MAX_UPLOAD_MIB * 1024 * 1024 + 1),
    })
    fireEvent.change(rendered.getByLabelText('录音转文字'), { target: { files: [large] } })
    await waitFor(() => {
      expect(rendered.getByRole('alert').textContent).toBe(zh['row.tooLarge'].replace('{mib}', String(MAX_UPLOAD_MIB)))
    })
    expect(api.importTranscriptAudio).not.toHaveBeenCalled()
  })

  it('refuses an oversized file before reading its bytes', async () => {
    const api = remotes()
    const rendered = view({ inputActions: actions(), remotes: api, sessionId: SessionId('s-1') })
    const large = new File([new Uint8Array([1])], 'huge.m4a')
    Object.defineProperty(large, 'size', { value: MAX_UPLOAD_MIB * 1024 * 1024 + 1 })
    const read = vi.spyOn(large, 'arrayBuffer')
    fireEvent.change(rendered.getByLabelText('录音转文字'), { target: { files: [large] } })
    await waitFor(() => {
      expect(rendered.getByRole('alert').textContent).toBe(zh['row.tooLarge'].replace('{mib}', String(MAX_UPLOAD_MIB)))
    })
    expect(read).not.toHaveBeenCalled()
    expect(api.importTranscriptAudio).not.toHaveBeenCalled()
  })

  it('reports a rejected transport and re-enables the row', async () => {
    const api = remotes({
      importTranscriptAudio: vi.fn(() => Promise.reject(new Error('transport terminated'))),
    })
    const rendered = view({ inputActions: actions(), remotes: api, sessionId: SessionId('s-1') })
    fireEvent.change(rendered.getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'gone.m4a')] },
    })
    await waitFor(() => { expect(rendered.getByRole('alert').textContent).toBe(zh['row.importFailed']) })
    expect(rendered.getByRole('menuitem', { name: '录音转文字' }).hasAttribute('disabled')).toBe(false)
  })

  it('reports an unreadable recording', async () => {
    const api = remotes()
    const rendered = view({ inputActions: actions(), remotes: api, sessionId: SessionId('s-1') })
    const broken = new File([new Uint8Array([1])], 'broken.m4a')
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('webview'))
    vi.stubGlobal('FileReader', class BoomReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsArrayBuffer(): void {
        this.onerror?.()
      }
    })
    fireEvent.change(rendered.getByLabelText('录音转文字'), { target: { files: [broken] } })
    await waitFor(() => { expect(rendered.getByRole('alert').textContent).toBe(zh['row.readFailed']) })
    expect(api.importTranscriptAudio).not.toHaveBeenCalled()
  })

  it('shows the host message and falls back when it is empty', async () => {
    const denied = remotes({
      importTranscriptAudio: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('session/transcript-audio-failed', '录音超过 1 MiB 上限', { code: 'too-large' }),
      })),
    })
    const first = view({ inputActions: actions(), remotes: denied, sessionId: SessionId('s-1') })
    fireEvent.change(within(first.container).getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'busy.m4a')] },
    })
    await waitFor(() => { expect(within(first.container).getByRole('alert').textContent).toBe('录音超过 1 MiB 上限') })

    const silent = remotes({
      importTranscriptAudio: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('gateway/internal', '  ', {}),
      })),
    })
    const second = view({ inputActions: actions(), remotes: silent, sessionId: SessionId('s-1') })
    fireEvent.change(within(second.container).getByLabelText('录音转文字'), {
      target: { files: [new File([new Uint8Array([1])], 'quiet.m4a')] },
    })
    await waitFor(() => { expect(within(second.container).getByRole('alert').textContent).toBe(zh['row.importFailed']) })
  })
})

describe('transcript audio helpers', () => {
  it('reads bytes and falls back to FileReader after a WebView rejection', async () => {
    await expect(readAudioFile(new File([new Uint8Array([9])], 'ok.wav'))).resolves.toEqual(new Uint8Array([9]))

    const broken = new File([new Uint8Array([1])], 'broken.wav')
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('webview'))
    vi.stubGlobal('FileReader', class FakeReader {
      result: ArrayBuffer | string | null = new Uint8Array([4, 5]).buffer
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsArrayBuffer(): void {
        this.onload?.()
      }
    })
    await expect(readAudioFile(broken)).resolves.toEqual(new Uint8Array([4, 5]))

    // An older WebView File without `arrayBuffer` goes straight to FileReader.
    const legacy = new File([new Uint8Array([6])], 'legacy.wav')
    Object.defineProperty(legacy, 'arrayBuffer', { value: undefined })
    await expect(readAudioFile(legacy)).resolves.toEqual(new Uint8Array([4, 5]))
  })

  it('reports a FileReader that cannot produce a buffer', async () => {
    const broken = new File([new Uint8Array([1])], 'broken.wav')
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('webview'))
    vi.stubGlobal('FileReader', class StringReader {
      result: string | null = 'not-a-buffer'
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsArrayBuffer(): void {
        this.onload?.()
      }
    })
    await expect(readAudioFile(broken)).rejects.toThrow('FileReader failed')
  })

  it('reads the first picked file only', () => {
    const first = new File([new Uint8Array([1])], 'first.wav')
    expect(fileFromPicker({ target: { files: [first] } } as never)).toBe(first)
    expect(fileFromPicker({ target: { files: [] } } as never)).toBeUndefined()
  })

  it('encodes bytes beyond one chunk-append window', () => {
    expect(encodeAudioBytes(new Uint8Array([97, 98, 99]))).toBe(btoa('abc'))
    const long = new Uint8Array(0x8001).fill(65)
    expect(encodeAudioBytes(long).length).toBeGreaterThan(encodeAudioBytes(new Uint8Array(8).fill(65)).length)
  })
})
