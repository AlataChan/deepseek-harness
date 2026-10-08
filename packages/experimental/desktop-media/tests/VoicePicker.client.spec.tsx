/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { encodeMediaBytes, isCloneAudioName, readCloneFile, VoicePicker } from '../src/client/VoicePicker.tsx'
import { zh } from '../src/client/locales.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { MediaSessionRemotes } from '../src/client/remotes.ts'

const t: TranslateNS<'desktop-media'> = key => (
  key in zh ? zh[key as keyof typeof zh] : key
)

function remotes(overrides: Partial<MediaSessionRemotes> = {}): MediaSessionRemotes {
  return {
    listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [] })),
    mediaRuntimeStatus: vi.fn(async () => ({ ok: true as const, value: { ready: true, guidance: '' } })),
    openMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    revealMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    copyMediaWorkPath: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/a.mp4' } })),
    listMediaVoices: vi.fn(async () => ({
      ok: true as const,
      value: [
        { voiceId: 'sys', label: '系统', system: true },
        { voiceId: 'mine', label: '我的', system: false },
      ],
    })),
    importMediaBytes: vi.fn(async () => ({
      ok: true as const,
      value: {
        artifactId: 'a_1',
        requestId: 'r_1',
        kind: 'import' as const,
        name: 'a.mp3',
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

describe('VoicePicker', () => {
  it('encodes bytes in 32 KiB chunks', () => {
    expect(encodeMediaBytes(new Uint8Array([97, 98, 99]))).toBe(btoa('abc'))
    const large = new Uint8Array(0x8001)
    large.fill(65)
    expect(encodeMediaBytes(large).length).toBeGreaterThan(encodeMediaBytes(new Uint8Array(8).fill(65)).length)
  })

  it('lists voices and imports a consented sample', async () => {
    const api = remotes()
    const onImported = vi.fn()
    const view = render(
      <VoicePicker
        remotes={api}
        sessionId="s-1"
        workspaceId="w-1"
        encodeBytes={encodeMediaBytes}
        onImported={onImported}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('系统')).toBeTruthy()
      expect(view.getByText('我的')).toBeTruthy()
    })
    fireEvent.click(view.getByText('新增克隆'))
    fireEvent.click(view.getByText('确认克隆'))
    expect(api.importMediaBytes).not.toHaveBeenCalled()
    fireEvent.click(view.getByText('取消'))
    fireEvent.click(view.getByText('新增克隆'))
    fireEvent.change(view.getByLabelText('新增克隆'), { target: { value: '旁白' } })
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.mp3')
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    })
    fireEvent.click(view.getByText('确认克隆'))
    expect(api.importMediaBytes).not.toHaveBeenCalled()
    const checks = view.getAllByRole('checkbox')
    fireEvent.click(checks[0]!)
    fireEvent.click(checks[1]!)
    fireEvent.click(view.getByText('确认克隆'))
    await waitFor(() => {
      expect(api.importMediaBytes).toHaveBeenCalledWith({
        filename: 'sample.mp3',
        bytes: encodeMediaBytes(new Uint8Array([1, 2, 3])),
        sessionId: 's-1',
        workspaceId: 'w-1',
      })
      expect(onImported).toHaveBeenCalledWith('a_1', '旁白', false)
    })
  })

  it('keeps the form open when import fails and uses the filename as the label', async () => {
    const api = remotes({
      listMediaVoices: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: '' } as never })),
      importMediaBytes: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: '' } as never })),
    })
    const view = render(
      <VoicePicker
        remotes={api}
        sessionId="s-1"
        encodeBytes={encodeMediaBytes}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('新增克隆'))
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File([new Uint8Array([1])], 'voice.wav')] },
    })
    fireEvent.click(view.getAllByRole('checkbox')[0]!)
    fireEvent.click(view.getByText('确认克隆'))
    await waitFor(() => {
      expect(api.importMediaBytes).toHaveBeenCalledWith({
        filename: 'voice.wav',
        bytes: encodeMediaBytes(new Uint8Array([1])),
        sessionId: 's-1',
      })
    })
    expect(view.getByText('确认克隆')).toBeTruthy()
  })

  it('uses the filename when the clone label is blank', async () => {
    const api = remotes()
    const onImported = vi.fn()
    const view = render(
      <VoicePicker
        remotes={api}
        sessionId="s-1"
        encodeBytes={encodeMediaBytes}
        onImported={onImported}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('新增克隆'))
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File([new Uint8Array([2])], 'blank.mp3')] },
    })
    fireEvent.click(view.getAllByRole('checkbox')[0]!)
    fireEvent.click(view.getByText('确认克隆'))
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith('a_1', 'blank.mp3', true)
    })
  })

  it('rejects a non-audio file and a failed read before import', async () => {
    expect(isCloneAudioName('a.MP3')).toBe(true)
    expect(isCloneAudioName('notes.txt')).toBe(false)
    const api = remotes()
    const view = render(
      <VoicePicker remotes={api} sessionId="s-1" encodeBytes={encodeMediaBytes} startAdding t={t} />,
    )
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File([new Uint8Array([1])], 'notes.txt')] },
    })
    fireEvent.click(view.getAllByRole('checkbox')[0]!)
    fireEvent.click(view.getByText('确认克隆'))
    expect(view.getByRole('alert').textContent).toBe(zh['voice.badFile'])
    expect(api.importMediaBytes).not.toHaveBeenCalled()

    const broken = new File([new Uint8Array([1])], 'sample.mp3')
    vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('webview'))
    const Original = FileReader
    class BoomReader extends Original {
      override readAsArrayBuffer(): void {
        this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
      }
    }
    vi.stubGlobal('FileReader', BoomReader)
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [broken] },
    })
    fireEvent.click(view.getByText('确认克隆'))
    await waitFor(() => {
      expect(view.getByRole('alert').textContent).toBe(zh['voice.readFailed'])
    })
    expect(api.importMediaBytes).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    await expect(readCloneFile(new File([new Uint8Array([9])], 'ok.wav'))).resolves.toEqual(new Uint8Array([9]))
  })
})
