/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MediaCard } from '../src/client/MediaCard.tsx'
import { setWorksOpen, worksOpen } from '../src/client/works-state.ts'
import { zh } from '../src/client/locales.ts'
import type { MediaSessionRemotes } from '../src/client/remotes.ts'

const t = (key: keyof typeof zh) => zh[key]

function remotes(): MediaSessionRemotes {
  return {
    listMediaWorks: vi.fn(async () => ({ ok: true as const, value: [] })),
    mediaRuntimeStatus: vi.fn(async () => ({ ok: true as const, value: { ready: true, guidance: '' } })),
    openMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    revealMediaWork: vi.fn(async () => ({ ok: true as const, value: { requested: true as const } })),
    copyMediaWorkPath: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/a.mp4' } })),
    listMediaVoices: vi.fn(async () => ({ ok: true as const, value: [] })),
    importMediaBytes: vi.fn(async () => ({ ok: true as const, value: {} as never })),
    saveMediaWorkAs: vi.fn(async () => ({ ok: true as const, value: { path: '/tmp/out.mp4' } })),
  }
}

function running() {
  return {
    callId: 'c1',
    name: 'media_create_video',
    argsRaw: '{}',
    turn: 1,
    step: 1,
    time: 0,
    subCalls: [],
  }
}

function settled(extra: {
  isError?: boolean
  error?: { name: string; code: string }
  meta?: unknown
  content?: readonly { type: 'text'; text: string }[]
}) {
  return {
    kind: 'tool-result' as const,
    seq: 1,
    time: 0,
    callId: 'c1',
    call: { name: 'media_create_video', argsRaw: '{}' },
    callTime: 0,
    content: extra.content ?? [{ type: 'text' as const, text: 'done' }],
    isError: extra.isError ?? false,
    subCalls: [],
    ...extra.error === undefined ? {} : { error: extra.error },
    ...extra.meta === undefined ? {} : { meta: extra.meta },
  }
}

afterEach(() => {
  setWorksOpen(false)
  cleanup()
})

describe('MediaCard', () => {
  it('renders running, failed, stopped, and successful video states', () => {
    const api = remotes()
    const run = render(
      <MediaCard
        toolName="media_create_video"
        block={running() as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    expect(run.getByText('进行中')).toBeTruthy()
    expect(run.getByText('media_create_video')).toBeTruthy()
    run.unmount()

    const failed = render(
      <MediaCard
        toolName="media_create_video"
        block={settled({ isError: true, error: { name: 'ToolError', code: 'failed' } }) as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    expect(failed.getByText('失败')).toBeTruthy()
    failed.unmount()

    const stopped = render(
      <MediaCard
        toolName="media_create_video"
        block={settled({
          isError: true,
          error: { name: 'ToolError', code: 'interrupted' },
        }) as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    expect(stopped.getByText('已停止')).toBeTruthy()
  })

  it('opens, reveals, and jumps to Works for a composed artifact', () => {
    const api = remotes()
    const view = render(
      <MediaCard
        toolName="media_compose"
        block={settled({
          meta: { kind: 'composed', artifactId: 'a_1', requestId: 'r_1' },
        }) as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    fireEvent.click(view.getByText('合成'))
    fireEvent.click(view.getByText('打开文件'))
    expect(api.openMediaWork).toHaveBeenCalledWith({ artifactId: 'a_1' })
    fireEvent.click(view.getByText('在文件夹中显示'))
    expect(api.revealMediaWork).toHaveBeenCalledWith({ artifactId: 'a_1' })
    fireEvent.click(view.getByText('在作品中查看'))
    expect(worksOpen()).toBe(true)
  })

  it('shows the voice picker on speech and clone cards', () => {
    const api = remotes()
    const speech = render(
      <MediaCard
        toolName="media_synthesize_speech"
        block={settled({ meta: { kind: 'speech', requestId: 'r_1', jobId: 'j_1' } }) as never}
        remotes={api}
        sessionId="s-1"
        workspaceId="w-1"
        t={t}
        onCloneImported={() => {}}
        {...{} as never}
      />,
    )
    fireEvent.click(speech.getByText('配音'))
    expect(speech.getByText('系统音色')).toBeTruthy()
    speech.unmount()

    const clone = render(
      <MediaCard
        toolName="media_clone_voice"
        block={settled({ meta: { kind: 'import', voiceId: 'v_1' } }) as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    fireEvent.click(clone.getByText('新增克隆'))
    expect(clone.getAllByText('新增克隆').length).toBeGreaterThan(0)

    const unknown = render(
      <MediaCard
        toolName="other"
        block={settled({ content: [] }) as never}
        remotes={api}
        sessionId="s-1"
        t={t}
        {...{} as never}
      />,
    )
    expect(unknown.getByText('素材')).toBeTruthy()
    expect(unknown.getByText('other')).toBeTruthy()
  })
})
