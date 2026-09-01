/** @vitest-environment jsdom */
/** Plus-menu occupant extracts a file and reports readiness. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { AttachSessionDocumentBridge } from '../src/client/AttachSessionDocumentBridge.tsx'

afterEach(cleanup)

describe('attach-session-document plus-menu bridge', () => {
  it('reports ready on mount and extracts once per file', async () => {
    const onReady = vi.fn()
    const onSettled = vi.fn()
    const remotes = {
      beginExtract: vi.fn(async () => ({ ok: true as const, value: 'h1' })),
      appendExtractChunk: vi.fn(async () => ({ ok: true as const, value: undefined })),
      finishExtract: vi.fn(async () => ({
        ok: true as const,
        value: { filename: '制度.pdf', text: '正文', truncated: false },
      })),
    }
    const view = render(
      <AttachSessionDocumentBridge
        file={null}
        onReady={onReady}
        onSettled={onSettled}
        remotes={remotes}
      />,
    )
    expect(onReady).toHaveBeenCalledWith(true)
    expect(onSettled).not.toHaveBeenCalled()
    const file = new File(['body'], '制度.pdf', { type: 'application/pdf' })
    view.rerender(
      <AttachSessionDocumentBridge
        file={file}
        onReady={onReady}
        onSettled={onSettled}
        remotes={remotes}
      />,
    )
    await vi.waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith({
        ok: true,
        filename: '制度.pdf',
        text: '正文',
        truncated: false,
      })
    })
    act(() => { view.unmount() })
    expect(onReady).toHaveBeenLastCalledWith(false)
  })
})
