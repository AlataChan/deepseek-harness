/** @vitest-environment jsdom */
/** Plus-menu occupant opens the picker on a new request and reports readiness. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { AttachKnowledgeBridge } from '../src/client/AttachKnowledgeBridge.tsx'

afterEach(cleanup)

describe('attach-knowledge plus-menu bridge', () => {
  it('reports ready on mount and opens the picker once per new request', () => {
    const onReady = vi.fn()
    const openPicker = vi.fn()
    const view = render(
      <AttachKnowledgeBridge openRequest={0} onReady={onReady} openPicker={openPicker} />,
    )
    expect(onReady).toHaveBeenCalledWith(true)
    expect(openPicker).not.toHaveBeenCalled()
    view.rerender(
      <AttachKnowledgeBridge openRequest={1} onReady={onReady} openPicker={openPicker} />,
    )
    expect(openPicker).toHaveBeenCalledTimes(1)
    view.rerender(
      <AttachKnowledgeBridge openRequest={1} onReady={onReady} openPicker={openPicker} />,
    )
    expect(openPicker).toHaveBeenCalledTimes(1)
    act(() => { view.unmount() })
    expect(onReady).toHaveBeenLastCalledWith(false)
  })
})
