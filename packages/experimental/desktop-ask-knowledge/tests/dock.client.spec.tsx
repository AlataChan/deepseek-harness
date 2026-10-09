/** @vitest-environment jsdom */
/** AskKnowledgeDock: hung library name, picked documents, and the change action. */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskKnowledgeDock } from '../src/client/AskKnowledgeDock.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = (key: keyof typeof zh, params?: Record<string, unknown>) =>
  String(zh[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
    (params ?? {})[name] === undefined ? match : String((params ?? {})[name]))

function dockProps(
  projection: unknown,
  selection: Record<string, readonly string[] | undefined>,
  openPicker: () => void,
) {
  return {
    sessionId: 's1',
    openPicker,
    t,
    useProjection: () => projection,
    useAskKnowledgeSelection: (
      selector: (state: Record<string, readonly string[] | undefined>) => unknown,
    ) => selector(selection),
  } as unknown as Parameters<typeof AskKnowledgeDock>[0]
}

describe('ask-knowledge dock', () => {
  it('shows the hung library and the picked document, then reopens the picker', () => {
    const openPicker = vi.fn()
    const view = render(
      <AskKnowledgeDock {...dockProps({ libraryId: '1', displayName: '制度库' }, { s1: ['raw/制度.md'] }, openPicker)} />,
    )
    expect(view.getByText('问知识')).toBeTruthy()
    expect(view.getByText('制度库')).toBeTruthy()
    expect(view.getByText('已选：制度')).toBeTruthy()
    view.getByRole('button', { name: '更换' }).click()
    expect(openPicker).toHaveBeenCalledTimes(1)
  })

  it('shows several picked documents as a head plus a count', () => {
    const view = render(
      <AskKnowledgeDock {...dockProps({ libraryId: '1', displayName: '制度库' }, { s1: ['raw/a.md', 'raw/b.md'] }, vi.fn())} />,
    )
    expect(view.getByText('已选：a 等 1 篇')).toBeTruthy()
  })

  it('renders nothing while unbound', () => {
    const view = render(<AskKnowledgeDock {...dockProps(null, {}, vi.fn())} />)
    expect(view.container.textContent).toBe('')
  })

  it('omits the document line without a picked selection', () => {
    const view = render(<AskKnowledgeDock {...dockProps({ libraryId: '1', displayName: '制度库' }, {}, vi.fn())} />)
    expect(view.getByText('制度库')).toBeTruthy()
    expect(view.queryByText(/已选/)).toBeNull()
  })
})
