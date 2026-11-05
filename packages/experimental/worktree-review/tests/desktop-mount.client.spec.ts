// @vitest-environment jsdom
/** Real discovery metadata and Client owners produce one effect-owned Changes tab. */
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRoot, TestSessions, createSlotRenderer, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { createSidebarRightController } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts'
import { parseDshClient } from '@deepseek-ai/dsh-client-modules/client'
import * as ForgeClient from '@deepseek-ai/dsh-experimental-client-ui-forge/client'
import * as Marker from '../src/client/index.ts'
import { expect, it, vi } from 'vitest'
import { createElement, Fragment } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import * as UiSession from '@deepseek-ai/dsh-client-ui-session/client'
import { keyedObservableHook } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bindings.tsx'
import { createSidebarRightStore } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts'
import { tabInfoFactory, type TabHookContext } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'


it('discovers the marker and actual Client once, mounts generated remotes, and unloads the sole tab', async () => {
  const manifest = record(JSON.parse(await readFile(join(process.cwd(), 'packages/experimental/worktree-review/package.json'), 'utf8')))
  if (typeof manifest.name !== 'string') throw new Error('package name is missing')
  const client = parseDshClient(manifest.name, record(manifest.dsh).client)
  expect(client?.inject).toEqual(['@deepseek-ai/dsh-experimental-client-ui-forge'])
  expect(record(record(manifest.exports)['./client']).default).toBe('./lib/client.js')
  const patch = await readFile(join(process.cwd(), 'packages/experimental/worktree-review/cordis.patch.yml'), 'utf8')
  expect(patch).not.toMatch(/forge-github|electron|forge-session|dsh-experimental-forge['"\s]/)
  const official = await readFile(join(process.cwd(), 'packages/bundle/desktop-app/cordis.patch.yml'))
  expect(createHash('sha1').update(`blob ${official.length}\0`).update(official).digest('hex')).toBe('c2368f664c4f148e727450d5205daf0dd321aa32')
  vi.useFakeTimers()
  const ctx = new Context()
  let releaseRoot: TestRoot | undefined
  let releaseNavigation: (() => void) | undefined
  let disposeView: (() => void) | undefined
  try {
    await ctx.plugin(TypertRegistry)
    let state: ForgePanelState = {
      directory: '/project', checkout: { state: 'ready', checkout: { root: '/project', branch: 'main', linked: false, commit: 'c'.repeat(40) } },
      local: null, worktree: {
        editable: true, blocker: null, request: null, created: null, creation: null, failure: null,
        missing: null, restoration: null, waiting: null,
      },
    }
    const wire = RemoteMock.create()
    wire.stream('forgePanel/follow', (_args, stream) => { stream.push(state) })
    wire.unary('forgePanel/localDiff', ok({ base: null, files: [], omitted: 0 }))
    for (const action of ['requestWorktree', 'cancelWorktree', 'stopCreation', 'retryWorktree', 'restoreWorktree', 'continueInProject']) {
      wire.unary(`forgePanel/${action}`, ok(undefined))
    }
    installConnection(ctx, { transport: { rpc: wire.rpc } })
    await ctx.plugin(Gateway)
    await ctx.plugin(SlotRegistry)
    const locale = new LocaleRuntime(ctx, undefined, { languages: ['zh-CN'], preference: 'zh' })
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
    ctx.slots.install(createSlotRenderer())
    const tabs = new SidebarRightTabRegistry(ctx)
    ctx.provide('sidebarRightTabs', tabs)
    const navigation = createSidebarRightController(tabs, (address, signal) => {
      expect(address).toBe('sidebar://worktree-review')
      expect(signal.aborted).toBe(false)
    }, {
      autoFullscreen: () => false,
      openWithFocus: (_session, open) => { open() },
      closeWithFocus: (_session, _pane, close) => { close() },
    })
    releaseNavigation = () => { navigation.controller.tabDomain.dispose() }
    ctx.provide('sidebarRight', navigation.controller)
    const sessions = new TestSessions(async (work) => { await act(async () => { await work() }) }, ctx)
    ctx.provide('sessions', sessions)
    await ctx.plugin(UiSession)
    releaseRoot = new TestRoot(ctx.slots, async (work) => { await work() })
    const removeConflict = tabs.register({ id: 'worktree-review', kind: 'worktree-review', title: () => 'Conflict' })
    const rejected = ctx.plugin(ForgeClient)
    await expect(rejected).rejects.toThrow('already registered')
    await rejected.dispose()
    expect(ctx.get('remote.forgePanel')).toBeUndefined()
    removeConflict()
    const actual = await ctx.plugin(ForgeClient)
    await ctx.plugin(Marker)
    expect(tabs.entries().map(tab => ({ id: tab.id, kind: tab.kind, title: tab.title('') })))
      .toEqual([{ id: 'worktree-review', kind: 'worktree-review', title: '变更' }])
    expect(ctx.get('remote.forgePanel')).toBeDefined()
    const guide = tabs.guide()[0]
    if (guide === undefined) throw new Error('Changes guide entry is missing')
    expect(guide.title()).toBe('变更')
    expect(guide.description?.()).toBe('查看本地差异和独立工作目录')
    expect(wire.log.calls().filter(call => call.endpoint.startsWith('forgePanel/'))).toHaveLength(0)

    const sessionId = await sessions.add({ id: 'mounted-local-review' })
    const reference = sessions.retain(sessionId)
    await reference.ready
    const store = createSidebarRightStore(() => ({ kind: 'worktree-review', title: '变更' })).create()
    const release = navigation.adopt(sessionId, store)
    navigation.controller.openTabIn(sessionId, 'worktree-review')
    const tab = navigation.controller.tabsIn(sessionId)[0]
    if (tab === undefined) throw new Error('Review tab was not committed')
    const occurrence = navigation.controller.tabDomain.occurrence(sessionId, { id: tab.id })
    const useTabNavigation = keyedObservableHook(key => key === tab.id ? occurrence.navigation : undefined) as TabHookContext['useTabNavigation']
    const hookContext: TabHookContext = {
      tabId: tab.id, title: false, fullscreen: false, active: true, shortcuts: [],
      signal: occurrence.signal, actions: occurrence.tabActions, useStore: bindSnapshotSelector(store), useTabNavigation,
    }
    let showReview = true
    await releaseRoot.declare({
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    }, ({ renderSlot, SessionProvider }) => createElement(Fragment, null,
      createElement(SessionProvider, { session: reference, children: createElement(Fragment, null,
        renderSlot('conversation.session.header.actions', {}),
        showReview ? renderSlot('sidebar.right.pane.tab', {}, { entryKey: 'worktree-review', hookContext }) : null,
      ) }), renderSlot('shell.overlay', {})))
    const view = render(ctx.slots.renderSlot('root', {}))
    disposeView = () => { view.unmount(); reference.release(); release() }
    await vi.waitFor(() => { expect(screen.getByText('没有本地变更')).toBeDefined() })
    expect(wire.log.calls('forgePanel/requestWorktree')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '变更' }))
    fireEvent.click(screen.getByRole('button', { name: '使用独立工作目录' }))
    await vi.waitFor(() => { expect(wire.log.calls('forgePanel/requestWorktree')).toHaveLength(1) })
    await vi.waitFor(() => { expect(screen.getByText('操作已完成')).toBeDefined() })
    state = { ...state, worktree: { ...state.worktree, request: { from: null } } }
    await act(async () => { wire.streams.push('forgePanel/follow', state); await wire.streams.drained('forgePanel/follow') })
    wire.unary('forgePanel/cancelWorktree', () => { throw new Error('Carrier refused cancellation') })
    fireEvent.click(screen.getByRole('button', { name: '取消创建' }))
    await vi.waitFor(() => { expect(screen.getByText('操作失败，请重试')).toBeDefined() })
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.queryByText('操作失败，请重试')).toBeNull()
    const created = { path: '/project/.agents/worktrees/local', branch: 'local', from: null, baseCommit: 'c'.repeat(40), repositoryRoot: '/project' }
    for (const [label, action, facts] of [
      ['停止创建', 'stopCreation', { creation: { phase: 'checkout', branch: 'local', from: null, held: true } }],
      ['重试', 'retryWorktree', { editable: false, creation: null, waiting: 'creation' }],
      ['恢复工作目录', 'restoreWorktree', { editable: false, waiting: null, created, missing: { branchExists: true } }],
      ['返回原项目', 'continueInProject', { editable: false, created, missing: null }],
    ] as const) {
      state = { ...state, worktree: { ...state.worktree, ...facts } }
      await act(async () => { wire.streams.push('forgePanel/follow', state); await wire.streams.drained('forgePanel/follow') })
      fireEvent.click(screen.getByRole('button', { name: label }))
      await vi.waitFor(() => { expect(wire.log.calls(`forgePanel/${action}`)).toHaveLength(1) })
    }
    showReview = false
    view.rerender(ctx.slots.renderSlot('root', {}))
    showReview = true
    view.rerender(ctx.slots.renderSlot('root', {}))
    await wire.streams.opened('forgePanel/follow', 2)
    expect(wire.log.calls('forgePanel/requestWorktree')).toHaveLength(1)
    disposeView()
    disposeView = undefined

    await actual.dispose()
    expect(tabs.entries()).toEqual([])
    expect(ctx.get('remote.forgePanel')).toBeUndefined()
    await ctx.plugin(ForgeClient)
    expect(tabs.entries()).toHaveLength(1)
  } finally {
    disposeView?.()
    releaseRoot?.release()
    releaseNavigation?.()
    await ctx.fiber.dispose()
    vi.useRealTimers()
  }
})

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected manifest object')
  return value as Record<string, unknown>
}
