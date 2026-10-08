/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { openListedSession, WorksPanel } from '../src/client/WorksPanel.tsx'
import { setWorksOpen } from '../src/client/works-state.ts'
import { zh } from '../src/client/locales.ts'
import type { MediaSessionRemotes, MediaWorkRow } from '../src/client/remotes.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'

const t = (key: keyof typeof zh) => zh[key]

const sample: MediaWorkRow = {
  artifactId: 'a_1',
  requestId: 'r_1',
  kind: 'video',
  name: '样片.mp4',
  sessionId: 's-1',
  createdAt: '2026-09-20T00:00:00.000Z',
  durationSeconds: 5,
}

const gone: MediaWorkRow = {
  ...sample,
  artifactId: 'a_2',
  kind: 'speech',
  name: '配音.mp3',
  sessionId: 's-gone',
  durationSeconds: undefined,
}

function remotes(overrides: Partial<MediaSessionRemotes> = {}): MediaSessionRemotes {
  return {
    listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [sample, gone] })),
    mediaRuntimeStatus: vi.fn(async () => ({
      ok: true as const,
      value: { ready: false, guidance: 'install' },
    })),
    openMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    revealMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    copyMediaWorkPath: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/a.mp4' } })),
    listMediaVoices: vi.fn(async () => ({ ok: true as const, value: [] })),
    importMediaBytes: vi.fn(async () => ({ ok: true as const, value: sample })),
    saveMediaWorkAs: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/out.mp4' } })),
    ...overrides,
  }
}

afterEach(() => {
  setWorksOpen(false)
  cleanup()
})

describe('WorksPanel', () => {
  it('renders nothing while closed and opens an empty list', async () => {
    const closed = render(
      <WorksPanel
        remotes={remotes({
          listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [] })),
        })}
        sessionsById={{}}
        openSession={() => {}}
        t={t}
      />,
    )
    expect(closed.queryByRole('dialog')).toBeNull()
    closed.unmount()

    setWorksOpen(true)
    const empty = render(
      <WorksPanel
        remotes={remotes({
          listMediaWorks: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: '' } as never })),
          mediaRuntimeStatus: vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: '' } as never })),
        })}
        sessionsById={{}}
        openSession={() => {}}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(empty.getByText('还没有作品，在会话中选择‘做视频’或‘做配音’开始')).toBeTruthy()
    })
  })

  it('filters, opens, reveals, copies, saves, and dismisses', async () => {
    const openSession = vi.fn()
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/tmp/dest')
    const copyText = vi.fn(async () => undefined)
    const api = remotes()
    setWorksOpen(true)
    const view = render(
      <WorksPanel
        remotes={api}
        current={{ id: 's-1', workspaceId: 'w-1' }}
        sessionsById={{ 's-1': { id: 's-1', workspaceId: 'w-1' } }}
        openSession={openSession}
        pickDirectory={pickDirectory}
        copyText={copyText}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('样片.mp4')).toBeTruthy()
    })
    expect(view.container.querySelector('[data-kind="video"]')).toBeTruthy()
    expect(view.container.querySelector('[data-kind="speech"]')).toBeTruthy()
    expect(view.getByText('还没有安装视频工具。请安装 FFmpeg 后运行 scripts/install-media-runtime.sh')).toBeTruthy()
    expect(view.getByText('5s')).toBeTruthy()
    expect(view.getByText('来源会话已删除')).toBeTruthy()

    fireEvent.click(view.getByText('全部'))
    await waitFor(() => {
      expect(api.listMediaWorks).toHaveBeenCalledWith(
        { workspaceId: 'w-1' },
        expect.any(AbortSignal),
      )
    })
    fireEvent.click(view.getByText('当前会话'))
    await waitFor(() => {
      expect(api.listMediaWorks).toHaveBeenCalledWith(
        { sessionId: 's-1' },
        expect.any(AbortSignal),
      )
    })

    const opens = view.getAllByText('打开文件')
    fireEvent.click(opens[0]!)
    expect(api.openMediaWork).toHaveBeenCalledWith({ artifactId: 'a_1' })
    fireEvent.click(view.getAllByText('在文件夹中显示')[0]!)
    expect(api.revealMediaWork).toHaveBeenCalledWith({ artifactId: 'a_1' })
    fireEvent.click(view.getAllByText('复制路径')[0]!)
    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith('/tmp/a.mp4')
    })
    fireEvent.click(view.getAllByText('查看会话')[0]!)
    expect(openSession).toHaveBeenCalledWith('s-1')

    fireEvent.click(view.getAllByText('另存为')[0]!)
    fireEvent.change(view.getByDisplayValue('样片.mp4'), { target: { value: 'out.mp4' } })
    fireEvent.submit(view.container.querySelector('form')!)
    await waitFor(() => {
      expect(pickDirectory).toHaveBeenCalledTimes(1)
    })
    fireEvent.click(view.getAllByText('另存为')[0]!)
    fireEvent.change(view.getByDisplayValue('样片.mp4'), { target: { value: 'out.mp4' } })
    fireEvent.submit(view.container.querySelector('form')!)
    await waitFor(() => {
      expect(api.saveMediaWorkAs).toHaveBeenCalledWith({
        artifactId: 'a_1',
        directory: '/tmp/dest',
        filename: 'out.mp4',
      })
    })

    fireEvent.keyDown(view.container.firstElementChild!, { key: 'Tab' })
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(view.container.firstElementChild!, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('closes from the header and the backdrop, and skips copy when the remote fails', async () => {
    const api = remotes({
      copyMediaWorkPath: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'x', message: '' } as never,
      })),
      mediaRuntimeStatus: vi.fn(async () => ({
        ok: true as const,
        value: { ready: true, guidance: '' },
      })),
    })
    const copyText = vi.fn(async () => undefined)
    setWorksOpen(true)
    const view = render(
      <WorksPanel
        remotes={api}
        sessionsById={{ 's-1': { id: 's-1' } }}
        openSession={() => {}}
        copyText={copyText}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('样片.mp4')).toBeTruthy()
    })
    expect(view.queryByText('还没有安装视频工具。请安装 FFmpeg 后运行 scripts/install-media-runtime.sh')).toBeNull()
    fireEvent.click(view.getAllByText('复制路径')[0]!)
    await waitFor(() => {
      expect(api.copyMediaWorkPath).toHaveBeenCalled()
    })
    expect(copyText).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: '关闭作品' }))
    expect(view.queryByRole('dialog')).toBeNull()
    view.unmount()

    setWorksOpen(true)
    const again = render(
      <WorksPanel
        remotes={api}
        sessionsById={{}}
        openSession={() => {}}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(again.getByRole('dialog')).toBeTruthy()
    })
    fireEvent.click(again.getByRole('presentation'))
    expect(again.queryByRole('dialog')).toBeNull()
  })

  it('opens a listed session through the helper', () => {
    const open = vi.fn()
    openListedSession('s-9', open)
    expect(open).toHaveBeenCalledWith(SessionId('s-9'))
  })
})
