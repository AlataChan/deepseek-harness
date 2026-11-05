// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalReviewBody } from '../src/client/LocalReviewTab.tsx'
import { en, zh, NS } from '../src/client/locales.ts'
import type { ForgePanelState } from '../src/types.ts'
afterEach(cleanup)
const state: ForgePanelState = {
  directory: '/project', checkout: { state: 'ready', checkout: { root: '/project', branch: 'main', linked: false, commit: 'abc' } }, local: null,
  worktree: {
    editable: true, blocker: null, request: null, created: null, creation: null, failure: null,
    missing: null, restoration: null, waiting: null,
  },
}
describe.each([['zh', zh], ['en', en]] as const)('local Changes UI %s', (_language, dictionary) => {
  it('requests only after a user click and renders escaped local diff text', async () => {
    const action = vi.fn(async () => {})
    const t = translator(_language)
    render(<LocalReviewBody state={state} disconnected={false} diff={{ base: null, omitted: 0, files: [{ path: 'file.ts', previousPath: null, status: 'modified', binary: false, oversized: false, untracked: false, additions: 1, deletions: 1, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+<script>after</script>'] }] }] }} error={false} busy={false} scope="uncommitted" onScope={vi.fn()} selected="file.ts" onSelect={vi.fn()} onAction={action} onRefresh={vi.fn()} t={t} />)
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: dictionary.create }))
    expect(action).toHaveBeenCalledExactlyOnceWith('requestWorktree')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('+<script>after</script>', { exact: false })).toBeDefined()
    expect(screen.queryByText(/GitHub|Submit review|发布|合并/)).toBeNull()
  })
})

// Selected local stream lifecycle cases adapted from the RC1 source ceiling.
import { createPanelSource } from '../src/client/source.ts'
import type { PanelStream } from '../src/client/source.ts'
function ready(overrides: Partial<ForgePanelState> = {}): ForgePanelState { return { ...state, ...overrides } }
/** A stream the test feeds by hand. */
function feed<F = ForgePanelState>() {
  const queue: F[] = []
  let wake: (() => void) | undefined
  let closed = false
  let failure: unknown
  const stream = {
    signal: undefined as AbortSignal | undefined,
    disposed: vi.fn(),
    push(frame: F) { queue.push(frame); wake?.() },
    fail(error: unknown) { failure = error; wake?.() },
    close() { closed = true; wake?.() },
    dispose() { stream.disposed(); closed = true; wake?.() },
    async *[Symbol.asyncIterator](): AsyncIterator<F> {
      while (true) {
        const next = queue.shift()
        if (next !== undefined) { yield next; continue }
        if (failure !== undefined) throw failure
        if (closed) return
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    },
  }
  return stream
}

function source() {
  const streams: ReturnType<typeof feed>[] = []
  const resets = new Set<() => void>()
  const panel = createPanelSource({
    open: (signal): PanelStream => {
      const stream = feed()
      stream.signal = signal
      streams.push(stream)
      return stream
    },
    subscribeReset: (listener) => {
      resets.add(listener)
      return () => { resets.delete(listener) }
    },
  })
  return { panel, streams, reset: () => { for (const listener of [...resets]) listener() }, resets }
}

/** Let the stream readers run every iteration that is ready. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('createPanelSource', () => {
  it('opens one stream for all subscribers and closes it with the last one', async () => {
    const { panel, streams, resets } = source()
    const observable = panel.hooks.panel
    expect(streams).toHaveLength(0)
    expect(observable.getSnapshot()).toEqual({ state: null, disconnected: false })
    const seen: unknown[] = []
    const first = observable.subscribe(() => { seen.push(observable.getSnapshot()) })
    const second = observable.subscribe(() => {})
    expect(streams).toHaveLength(1)
    expect(resets.size).toBe(1)

    streams[0]?.push(ready())
    await vi.waitFor(() => { expect(seen).toEqual([{ state: ready(), disconnected: false }]) })
    first()
    expect(streams[0]?.disposed).not.toHaveBeenCalled()
    second()
    expect(streams[0]?.disposed).toHaveBeenCalled()
    expect(streams[0]?.signal?.aborted).toBe(true)
    expect(resets.size).toBe(0)
    expect(observable.getSnapshot()).toEqual({ state: ready(), disconnected: false })

    const again = observable.subscribe(() => {})
    expect(streams).toHaveLength(2)
    again()
  })

  it('publishes every state of the running stream in order', async () => {
    const { panel, streams } = source()
    const seen: (ForgePanelState | null)[] = []
    const unsubscribe = panel.hooks.panel.subscribe(() => { seen.push(panel.hooks.panel.getSnapshot().state) })
    const later = ready({ directory: '/later' })

    streams[0]?.push(ready())
    streams[0]?.push(later)
    await vi.waitFor(() => { expect(seen).toEqual([ready(), later]) })
    unsubscribe()
  })

  it('ignores frames from a stream it closed', async () => {
    const { panel, streams } = source()
    const unsubscribe = panel.hooks.panel.subscribe(() => {})
    const stream = streams[0]
    unsubscribe()
    stream?.push(ready({ directory: '/late' }))
    await settle()

    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: null, disconnected: false })
  })

  it.each([
    ['ends', (stream: ReturnType<typeof feed>) => { stream.close() }],
    ['fails', (stream: ReturnType<typeof feed>) => { stream.fail(new Error('lost')) }],
  ])('marks the snapshot disconnected when the stream %s and reopens on demand', async (_label, end) => {
    const { panel, streams } = source()
    const unsubscribe = panel.hooks.panel.subscribe(() => {})
    streams[0]?.push(ready())
    await vi.waitFor(() => { expect(panel.hooks.panel.getSnapshot().state).not.toBeNull() })

    end(streams[0]!)
    await vi.waitFor(() => { expect(panel.hooks.panel.getSnapshot().disconnected).toBe(true) })
    expect(panel.hooks.panel.getSnapshot().state).toEqual(ready())
    panel.reconnect()
    expect(streams).toHaveLength(2)
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: ready(), disconnected: false })
    panel.reconnect()
    expect(streams).toHaveLength(2)
    unsubscribe()
    panel.reconnect()
    expect(streams).toHaveLength(2)
  })

  it('lets the next subscriber reopen a stream that ended after the last one left', async () => {
    const { panel, streams, resets } = source()
    const unsubscribe = panel.hooks.panel.subscribe(() => {})
    streams[0]?.push(ready())
    streams[0]?.close()
    await vi.waitFor(() => { expect(panel.hooks.panel.getSnapshot()).toEqual({ state: ready(), disconnected: true }) })

    unsubscribe()
    expect(resets.size).toBe(0)
    expect(streams[0]?.disposed).not.toHaveBeenCalled()
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: ready(), disconnected: true })

    const again = panel.hooks.panel.subscribe(() => {})
    expect(streams).toHaveLength(2)
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: ready(), disconnected: false })
    again()
  })

  it('replaces the stream after a transport reset and ignores the replaced one', async () => {
    const { panel, streams, reset } = source()
    const unsubscribe = panel.hooks.panel.subscribe(() => {})

    reset()

    expect(streams).toHaveLength(2)
    expect(streams[0]?.disposed).toHaveBeenCalled()
    expect(streams[0]?.signal?.aborted).toBe(true)
    streams[0]?.push(ready({ directory: '/stale' }))
    await settle()
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: null, disconnected: false })
    streams[1]?.push(ready())
    await vi.waitFor(() => { expect(panel.hooks.panel.getSnapshot()).toEqual({ state: ready(), disconnected: false }) })
    unsubscribe()
  })

  it('reopens a stream that ended when the transport resets', async () => {
    const { panel, streams, reset } = source()
    const unsubscribe = panel.hooks.panel.subscribe(() => {})
    streams[0]?.fail(new Error('lost'))
    await vi.waitFor(() => { expect(panel.hooks.panel.getSnapshot().disconnected).toBe(true) })

    reset()

    expect(streams).toHaveLength(2)
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: null, disconnected: false })
    unsubscribe()
  })

  it('closes the stream and drops every subscriber on close', async () => {
    const { panel, streams, resets } = source()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = panel.hooks.panel.subscribe(first)
    panel.hooks.panel.subscribe(second)

    panel.close()

    expect(streams).toHaveLength(1)
    expect(streams[0]?.disposed).toHaveBeenCalledOnce()
    expect(streams[0]?.signal?.aborted).toBe(true)
    expect(resets.size).toBe(0)
    panel.reconnect()
    expect(streams).toHaveLength(1)
    unsubscribe()
    panel.close()
    streams[0]?.push(ready())
    await settle()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(streams[0]?.disposed).toHaveBeenCalledOnce()
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: null, disconnected: false })
  })

  it('closes a source nobody subscribed to', () => {
    const { panel, streams } = source()
    panel.close()
    expect(streams).toHaveLength(0)
    expect(panel.hooks.panel.getSnapshot()).toEqual({ state: null, disconnected: false })
  })
})


import { diffRows } from '../src/client/diff-rows.ts'
import { orderedFiles } from '../src/client/file-tree.ts'
it('numbers context lines and preserves nonstandard hunk marker rows', () => {
  expect(diffRows({ oldStart: 2, oldLines: 1, newStart: 3, newLines: 1, lines: [' kept', '\\ No newline at end of file'] })).toEqual([
    { text: ' kept', kind: 'context', oldLine: 2, newLine: 3 },
    { text: '\\ No newline at end of file', kind: 'context', oldLine: null, newLine: null },
  ])
  const files = ['z.txt', 'a.txt'].map(path => ({ path, previousPath: null, status: 'added' as const, binary: false, oversized: false, untracked: true, additions: 0, deletions: 0, hunks: [] }))
  expect(orderedFiles(files).map(file => file.path)).toEqual(['a.txt', 'z.txt'])
  expect(files.map(file => file.path)).toEqual(['z.txt', 'a.txt'])
})

it.each([
  ['cancelWorktree', 'cancel', { request: { from: null } }],
  ['stopCreation', 'stop', { creation: { phase: 'checkout', branch: 'local', from: null, held: true } }],
  ['retryWorktree', 'retry', { editable: false, waiting: 'creation' }],
  ['restoreWorktree', 'restore', { missing: { branchExists: true } }],
  ['continueInProject', 'leave', { created: { path: '/project/.agents/worktrees/local', branch: 'local', from: null, baseCommit: 'abc', repositoryRoot: '/project' } }],
] as const)('dispatches the explicit %s control', (choice, label, worktree) => {
  const action = vi.fn(async () => {})
  render(<LocalReviewBody
    state={{ ...state, worktree: { ...state.worktree, ...worktree } }} disconnected={false} diff={null} error={false} busy={false}
    scope="uncommitted" onScope={vi.fn()} selected={undefined} onSelect={vi.fn()} onAction={action} onRefresh={vi.fn()}
    t={translator('en')}
  />)
  fireEvent.click(screen.getByRole('button', { name: en[label] }))
  expect(action).toHaveBeenCalledExactlyOnceWith(choice)
})

it('renders disconnection, empty diffs and unavailable project guidance without granting creation', () => {
  const refresh = vi.fn()
  const scope = vi.fn()
  render(<LocalReviewBody
    state={{ ...state, checkout: { state: 'none' }, worktree: { ...state.worktree, blocker: 'read-only' } }} disconnected
    diff={{ base: null, files: [], omitted: 2 }} error busy={false} scope="uncommitted" onScope={scope}
    selected={undefined} onSelect={vi.fn()} onAction={vi.fn()} onRefresh={refresh} t={translator('en')}
  />)
  expect(screen.getByText(en.readonly)).toBeDefined()
  expect(screen.getByText(en.notGit)).toBeDefined()
  expect(screen.getByText(en.disconnected)).toBeDefined()
  expect(screen.getByText(en.unavailable)).toBeDefined()
  expect(screen.getByText(en.empty)).toBeDefined()
  expect(screen.getByText(en.omitted)).toBeDefined()
  expect(screen.getByRole('button', { name: en.create })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  expect(refresh).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: en.staged }))
  expect(scope).toHaveBeenCalledExactlyOnceWith('staged')
})

it.each(['binary', 'oversized'] as const)('labels %s content and permits selection of another file', (kind) => {
  const select = vi.fn()
  const files = ['a.txt', 'z.txt'].map(path => ({
    path, previousPath: null, status: 'added' as const, binary: kind === 'binary', oversized: kind === 'oversized',
    untracked: true, additions: 0, deletions: 0, hunks: [],
  }))
  render(<LocalReviewBody
    state={state} disconnected={false} diff={{ base: null, files, omitted: 0 }} error={false} busy={false}
    scope="uncommitted" onScope={vi.fn()} selected="a.txt" onSelect={select} onAction={vi.fn()} onRefresh={vi.fn()}
    t={translator('en')}
  />)
  expect(screen.getByText(en[kind])).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'z.txt' }))
  expect(select).toHaveBeenCalledExactlyOnceWith('z.txt')
})

import { act } from '@testing-library/react'
import { SlotTestRuntime, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { keyedObservableHook } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bindings.tsx'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { createSidebarRightController } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts'
import { createSidebarRightStore } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts'
import { tabInfoFactory, type TabHookContext } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { LocalReviewTab, type LocalReviewInjected } from '../src/client/LocalReviewTab.tsx'
import type { ForgeLocalDiff } from '../src/types.ts'

it('binds the real tab lifecycle, aborts stale diff reads and releases its stream when hidden', async () => {
  const runtime = await SlotTestRuntime.create()
  const sessionId = await runtime.sessions.add({ id: 'local-review-lifecycle' })
  const reference = runtime.sessions.retain(sessionId)
  await reference.ready
  const tabs = new SidebarRightTabRegistry(runtime.ctx)
  tabs.register({ id: 'worktree-review', kind: 'worktree-review', title: () => 'Changes' })
  const navigation = createSidebarRightController(tabs, () => { throw new Error('No resource should open') }, {
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => { open() },
    closeWithFocus: (_session, _pane, close) => { close() },
  })
  const instance = createSidebarRightStore(() => ({ kind: 'worktree-review', title: 'Changes' })).create()
  const release = navigation.adopt(sessionId, instance)
  navigation.controller.openTabIn(sessionId, 'worktree-review')
  const tab = navigation.controller.tabsIn(sessionId)[0]
  if (tab === undefined) throw new Error('Expected committed review tab')
  const occurrence = navigation.controller.tabDomain.occurrence(sessionId, { id: tab.id })
  const useTabNavigation = keyedObservableHook(key => key === tab.id ? occurrence.navigation : undefined) as TabHookContext['useTabNavigation']
  const hookContext: TabHookContext = {
    tabId: tab.id, title: false, fullscreen: false, active: true, shortcuts: [],
    signal: occurrence.signal, actions: occurrence.tabActions, useStore: bindSnapshotSelector(instance), useTabNavigation,
  }
  const local = source()
  const reads: { signal: AbortSignal; result: PromiseWithResolvers<ForgeLocalDiff> }[] = []
  const readDiff: LocalReviewInjected['readDiff'] = (_session, _scope, signal) => {
    const result = Promise.withResolvers<ForgeLocalDiff>()
    reads.push({ signal, result })
    return result.promise
  }
  const controls: PromiseWithResolvers<undefined>[] = []
  const actions: string[] = []
  const action: LocalReviewInjected['action'] = (_session, choice) => {
    actions.push(choice)
    const control = Promise.withResolvers<undefined>()
    controls.push(control)
    return control.promise
  }
  const firstDiff: ForgeLocalDiff = { base: null, omitted: 0, files: ['a.txt', 'z.txt'].map(path => ({
    path, previousPath: null, status: 'added', binary: false, oversized: false, untracked: true,
    additions: 1, deletions: 0, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+local'] }],
  })) }

  try {
    await runtime.declare({ 'sidebar.right.pane.tab': {
      kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } },
    } })
    const locale = new LocaleRuntime(runtime.ctx, undefined, { languages: ['en'], preference: 'en' })
    locale.register(NS, { en, zh })
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.slots.register({ name: 'sidebar.right.pane.tab', key: 'worktree-review', locale: NS, inject: () => ({
      source: () => local.panel, action, readDiff,
    }) }, LocalReviewTab)
    const view = runtime.renderSlot('sidebar.right.pane.tab', {}, { session: reference, entryKey: 'worktree-review', hookContext })
    await act(async () => { local.streams[0]?.push(ready()); await settle() })
    expect(reads).toHaveLength(1)
    await act(async () => { local.streams[0]?.push(ready({ directory: '/project/other' })); await settle() })
    expect(reads[0]?.signal.aborted).toBe(true)
    expect(reads).toHaveLength(2)
    await act(async () => { reads[0]?.result.resolve({ base: null, omitted: 0, files: [] }); await settle() })
    expect(view.view.queryByText(en.empty)).toBeNull()
    await act(async () => { reads[1]?.result.resolve(firstDiff); await settle() })
    expect(view.view.getByRole('article', { name: 'a.txt' })).toBeDefined()
    fireEvent.click(view.view.getByRole('button', { name: 'z.txt' }))
    expect(view.view.getByRole('article', { name: 'z.txt' })).toBeDefined()
    fireEvent.click(view.view.getByRole('button', { name: en.staged }))
    fireEvent.click(view.view.getByRole('button', { name: en.unstaged }))
    await act(async () => { reads[2]?.result.reject(new Error('stale comparison')); await settle() })
    expect(view.view.queryByText(en.unavailable)).toBeNull()
    await act(async () => { reads[3]?.result.reject(new Error('local comparison unavailable')); await settle() })
    expect(view.view.getByText(en.unavailable)).toBeDefined()
    fireEvent.click(view.view.getByRole('button', { name: en.refresh }))
    await act(async () => { reads[4]?.result.resolve(firstDiff); await settle() })
    fireEvent.click(view.view.getByRole('button', { name: en.create }))
    expect(actions).toEqual(['requestWorktree'])
    expect(view.view.getByRole('button', { name: en.create })).toHaveProperty('disabled', true)
    await act(async () => { controls[0]?.resolve(undefined); await settle() })
    expect(view.view.getByRole('button', { name: en.create })).toHaveProperty('disabled', false)
    await act(async () => { instance.actions.setExpanded(sessionId, false); await settle() })
    expect(local.streams[0]?.signal?.aborted).toBe(true)
    await act(async () => { instance.actions.setExpanded(sessionId, true); await settle() })
    expect(local.streams).toHaveLength(2)
    fireEvent.click(view.view.getByRole('button', { name: en.create }))
    await runtime.dispose()
    navigation.controller.tabDomain.dispose()
    await act(async () => { controls[1]?.resolve(undefined); await settle() })
  } finally {
    local.panel.close()
    release()
    navigation.controller.tabDomain.dispose()
    reference.release()
    await runtime.dispose()
  }
})

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
const localeContexts: Context[] = []
afterEach(async () => { await Promise.all(localeContexts.splice(0).map(context => context.fiber.dispose())) })
function translator(language: 'zh' | 'en') {
  const ctx = new Context()
  localeContexts.push(ctx)
  const locale = new LocaleRuntime(ctx, undefined, { languages: [language], preference: language })
  locale.register(NS, { zh, en })
  return locale.bind(NS)
}
it('displays a restoration phase even when no creation is running', () => {
  render(<LocalReviewBody state={{ ...state, worktree: { ...state.worktree, restoration: { phase: 'prepare' } } }}
    disconnected={false} diff={null} error={false} busy={false} scope="uncommitted" onScope={vi.fn()}
    selected={undefined} onSelect={vi.fn()} onAction={vi.fn()} onRefresh={vi.fn()} t={translator('en')} />)
  expect(screen.getByText(en.prepare)).toBeDefined()
})

it('keeps a failed checkout reason visible alongside retry', () => {
  render(<LocalReviewBody state={{ ...state, worktree: { ...state.worktree, waiting: 'creation',
    failure: { branch: 'local', from: null, phase: 'checkout', message: 'Local checkout was refused' },
  } }} disconnected={false} diff={null} error={false} busy={false} scope="uncommitted" onScope={vi.fn()}
  selected={undefined} onSelect={vi.fn()} onAction={vi.fn()} onRefresh={vi.fn()} t={translator('zh')} />)
  expect(screen.getByRole('alert').textContent).toContain('Local checkout was refused')
  expect(screen.getByRole('button', { name: zh.retry })).toBeDefined()
})
