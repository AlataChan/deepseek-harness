// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListEntriesValue, SessionWorkspaceEntry } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { FileTree } from '../src/client/FileTree.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

const t = (key: keyof typeof zh) => zh[key]

function listing(entries: SessionWorkspaceEntry[], path = '/proj'): SessionListEntriesValue {
  return { path, root: '/proj', entries, truncated: false }
}

function ok(value: SessionListEntriesValue): RemoteResult<SessionListEntriesValue> {
  return { ok: true, value }
}

function file(name: string, hidden = false): SessionWorkspaceEntry {
  return { name, path: `/proj/${name}`, kind: 'file', hidden, symlink: false }
}

function dir(name: string): SessionWorkspaceEntry {
  return { name, path: `/proj/${name}`, kind: 'directory', hidden: false, symlink: false }
}

function sessions(current?: string, cwd?: string): SessionListState {
  return {
    ids: current === undefined ? [] : [current as never],
    byId: current === undefined
      ? {}
      : {
        [current]: {
          id: current as never,
          displayTitle: current,
          ...cwd === undefined ? {} : { cwd },
          running: false,
          blank: false,
          updatedAt: 0,
        },
      },
    current: current as never,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function mount(options: {
  current?: string
  cwd?: string
  wide?: boolean
  list?: (sessionId: string, path?: string, signal?: AbortSignal) => Promise<RemoteResult<SessionListEntriesValue>>
  openPath?: (path: string) => Promise<void>
} = {}) {
  const listEntries = vi.fn(options.list ?? (async () => ok(listing([file('a.ts'), dir('src'), file('.env', true)]))))
  const openPath = vi.fn(options.openPath ?? (async () => undefined))
  const expandSidebar = vi.fn()
  const selectFiles = vi.fn()
  const state = { current: options.current, cwd: options.cwd }
  const view = render(
    <FileTree
      wide={options.wide ?? true}
      expandSidebar={expandSidebar}
      selectFiles={selectFiles}
      listEntries={listEntries}
      openPath={openPath}
      useSessions={selector => selector(sessions(state.current, state.cwd))}
      t={t}
    />,
  )
  return {
    listEntries,
    openPath,
    expandSidebar,
    selectFiles,
    rerender(next: { current?: string; cwd?: string }) {
      state.current = next.current
      state.cwd = next.cwd
      view.rerender(
        <FileTree
          wide
          expandSidebar={expandSidebar}
          selectFiles={selectFiles}
          listEntries={listEntries}
          openPath={openPath}
          useSessions={selector => selector(sessions(state.current, state.cwd))}
          t={t}
        />,
      )
    },
  }
}

describe('FileTree', () => {
  it('asks the user to open a session when none is selected', () => {
    mount()
    expect(screen.getByText(zh['empty.session'])).toBeTruthy()
  })

  it('lists the session cwd and opens a file, without opening a broken symlink', async () => {
    const broken: SessionWorkspaceEntry = {
      name: 'gone', path: '/proj/gone', kind: 'broken-symlink', hidden: false, symlink: true,
    }
    const b = mount({
      current: 's1',
      cwd: '/proj',
      list: async () => ok(listing([file('a.ts'), broken])),
    })
    await waitFor(() => { expect(screen.getByText('a.ts')).toBeTruthy() })
    expect(b.listEntries).toHaveBeenCalledWith('s1', undefined, expect.any(AbortSignal))
    fireEvent.click(screen.getByText('a.ts'))
    expect(b.openPath).toHaveBeenCalledWith('/proj/a.ts')
    fireEvent.click(screen.getByText('gone'))
    expect(b.openPath).toHaveBeenCalledTimes(1)
  })

  it('hides dotfiles until the hidden toggle is pressed', async () => {
    mount({ current: 's1', cwd: '/proj' })
    await waitFor(() => { expect(screen.getByText('a.ts')).toBeTruthy() })
    expect(screen.queryByText('.env')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['hidden.show'] }))
    expect(screen.getByText('.env')).toBeTruthy()
  })

  it('expands a directory with a child list and does not apply a stale list after cwd change', async () => {
    let resolveFirst!: (value: RemoteResult<SessionListEntriesValue>) => void
    const first = new Promise<RemoteResult<SessionListEntriesValue>>((resolve) => { resolveFirst = resolve })
    const b = mount({
      current: 's1',
      cwd: '/old',
      list: (sessionId, path) => {
        if (path === undefined && sessionId === 's1') return first
        return Promise.resolve(ok(listing([file('b.ts')], '/new')))
      },
    })
    b.rerender({ current: 's2', cwd: '/new' })
    resolveFirst(ok(listing([file('stale.ts')], '/old')))
    await waitFor(() => { expect(screen.getByText('b.ts')).toBeTruthy() })
    expect(screen.queryByText('stale.ts')).toBeNull()
  })

  it('expands a directory row by listing its absolute path', async () => {
    const b = mount({
      current: 's1',
      cwd: '/proj',
      list: async (_sessionId, path) => {
        if (path === '/proj/src') return ok(listing([file('index.ts')], '/proj/src'))
        return ok(listing([dir('src')]))
      },
    })
    await waitFor(() => { expect(screen.getByText('src')).toBeTruthy() })
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => { expect(screen.getByText('index.ts')).toBeTruthy() })
    expect(b.listEntries).toHaveBeenCalledWith('s1', '/proj/src', expect.any(AbortSignal))
  })

  it('shows the outside-root sentence when the Host rejects a walk', async () => {
    mount({
      current: 's1',
      cwd: '/proj',
      list: async () => ({
        ok: false,
        error: new RemoteError('session/entries-outside-root', 'outside', { path: '/etc', root: '/proj' }),
      }),
    })
    await waitFor(() => { expect(screen.getByText(zh['error.outside'])).toBeTruthy() })
  })

  it('expands the sidebar into the files region from the rail icon', () => {
    const b = mount({ wide: false, current: 's1', cwd: '/proj' })
    fireEvent.click(screen.getByRole('button', { name: zh['region.files'] }))
    expect(b.selectFiles).toHaveBeenCalledOnce()
    expect(b.expandSidebar).toHaveBeenCalledOnce()
    expect(b.listEntries).not.toHaveBeenCalled()
  })
})
