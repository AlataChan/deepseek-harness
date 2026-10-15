// @vitest-environment jsdom
/** Both selection orders resolve a workspace-owned Session before assistant binding. */
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import { AssistantConversationId, AssistantProfileId, type AssistantConversation,
  type CreateAssistantConversationOptions, type AssistantProfile } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AssistantConversationLauncher } from '../src/client/conversation-launch.ts'
import { AssistantWorkspaceDialog } from '../src/client/AssistantWorkspaceDialog.tsx'
import { AssistantIdentityDock } from '../src/client/AssistantIdentityDock.tsx'
import { zh } from '../src/client/locales.ts'

const profile: AssistantProfile = { id: AssistantProfileId('chosen'), name: '社区助理', responsibility: '社区服务',
  avatar: 'character:bot-reader', revision: 1, createdAt: 1, updatedAt: 1 }
const sid = SessionId('same-session')
const workspace: WorkspaceView = { workspaceId: 'workspace' as WorkspaceView['workspaceId'], path: '/project',
  title: 'Project', sessionIds: [sid], createdAt: '', updatedAt: '' }
const contexts: Context[] = []
afterEach(async () => { cleanup(); for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function bench(selected = false) {
  const ctx = new Context()
  contexts.push(ctx)
  const row: SessionSummary = { id: sid, blank: true, running: false, cwd: workspace.path,
    displayTitle: 'Project', retainedBy: { mainView: 1 }, updatedAt: 1 }
  const sessions = createSnapshotStore<SessionListState>({ phase: 'ready', ids: selected ? [sid] : [],
    byId: selected ? { [sid]: row } : {}, projectionsBySession: {} })
  const workspaces = createSnapshotStore<WorkspaceSnapshot>({ phase: 'ready', items: [workspace],
    state: 'idle', archivedSessionIds: [], pinnedSessionIds: [], error: null })
  const create = vi.fn(async () => sid)
  const open = vi.fn()
  let navigation = new AbortController()
  ctx.layout = { beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal } } as never
  ctx.reflect.provide('sessions', { list: sessions, create })
  const registry = { list: workspaces, create: vi.fn(async () => workspace) }
  ctx.workspaces = registry as never
  ctx.uiWorkspace = { openSession: open } as never
  let binding: AssistantConversation | undefined
  const bind = vi.fn(async (profileId: AssistantProfileId, options?: CreateAssistantConversationOptions) => {
    if (!options?.rootSessionId) throw new Error('Expected a workspace-owned Session')
    binding = { id: AssistantConversationId('binding'), profileId, rootSessionId: options.rootSessionId, createdAt: 1, updatedAt: 1 }
    return binding
  })
  const read = vi.fn(async () => binding)
  const clear = vi.fn(async () => { binding = undefined })
  const launcher = new AssistantConversationLauncher(ctx, {
    clearConversationBinding: clear, createConversation: bind, startNewTopic: bind, getConversationBySession: read,
  })
  ctx.effect(() => () => { launcher.dispose() })
  const loadProfile = vi.fn(async () => profile)
  const props = { launcher, workspaces: ctx.workspaces, loadProfile, pickDirectory: vi.fn(async () => '/project'), t: makeTranslate(zh) }
  return { ctx, sessions, launcher, create, bind, read, open, clear, props, loadProfile,
    setBinding: (value: AssistantConversation) => { binding = value } }
}

describe('Assistant and workspace selection', () => {
  it('selects assistant first without creating a throwaway Session, then binds the chosen workspace Session', async () => {
    const b = bench()
    render(<AssistantWorkspaceDialog {...b.props} />)
    let pending!: Promise<void>
    act(() => { pending = b.launcher.start(profile.id) })
    expect(await screen.findByText(`${zh.currentAssistant}: ${profile.name}`)).toBeTruthy()
    expect(b.create).not.toHaveBeenCalled()
    expect(b.bind).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByText(workspace.title)); await pending })
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: workspace.workspaceId })
    expect(b.bind).toHaveBeenCalledExactlyOnceWith(profile.id, { rootSessionId: sid })
    expect(b.open).toHaveBeenCalledExactlyOnceWith(sid)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('selects workspace first and shows the same bound Session identity before a message is sent', async () => {
    const b = bench(true)
    const changes = { subscribe: b.launcher.subscribe, getSnapshot: b.launcher.getBindingRevision }
    render(<AssistantIdentityDock sessionId={sid} loadConversation={b.read} loadProfile={b.loadProfile}
      bindingChanges={changes} t={makeTranslate(zh)} />)
    expect(screen.queryByTestId('assistant-conversation-identity')).toBeNull()
    await act(async () => { await b.launcher.start(profile.id) })
    expect((await screen.findByTestId('assistant-conversation-identity')).textContent).toContain(profile.name)
    expect(b.create).not.toHaveBeenCalled()
    expect(b.bind).toHaveBeenCalledExactlyOnceWith(profile.id, { rootSessionId: sid })
    expect(b.open).toHaveBeenCalledExactlyOnceWith(sid)
  })

  it('cancels the workspace dialog without creating or binding a Session', async () => {
    const b = bench()
    render(<AssistantWorkspaceDialog {...b.props} />)
    let pending!: Promise<void>
    act(() => { pending = b.launcher.start(profile.id) })
    await act(async () => { fireEvent.click(screen.getByLabelText(zh.cancel)); await pending })
    expect(b.create).not.toHaveBeenCalled()
    expect(b.bind).not.toHaveBeenCalled()
    expect(b.open).not.toHaveBeenCalled()
  })

  it('deduplicates repeated clicks and rejects another assistant while a workspace choice is pending', async () => {
    const b = bench()
    const first = b.launcher.start(profile.id)
    expect(b.launcher.start(profile.id)).toBe(first)
    await expect(b.launcher.start(AssistantProfileId('other'))).rejects.toThrow('pending')
    b.launcher.choose(workspace)
    await first
    expect(b.bind).toHaveBeenCalledTimes(1)
  })

  it('closes a pending choice if another navigation supersedes it', async () => {
    const b = bench()
    const pending = b.launcher.start(profile.id)
    b.ctx.layout.beginNavigation()
    await pending
    expect(b.launcher.getSnapshot()).toBeNull()
    expect(b.create).not.toHaveBeenCalled()
    expect(b.open).not.toHaveBeenCalled()
  })

  it('finishes binding and notifies other observers when one subscriber throws', async () => {
    const b = bench()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const observed = vi.fn()
    b.launcher.subscribe(() => { throw new Error('observer failed') })
    b.launcher.subscribe(observed)
    try {
      const pending = b.launcher.start(profile.id)
      b.launcher.choose(workspace)
      await pending
      expect(b.open).toHaveBeenCalledExactlyOnceWith(sid)
      expect(observed).toHaveBeenCalled()
      expect(log).toHaveBeenCalled()
    } finally { b.launcher.dispose(); log.mockRestore() }
  })

  it('does not relabel a blank Session already bound to another assistant', async () => {
    const b = bench(true)
    const fresh = SessionId('fresh-independent-session')
    b.create.mockResolvedValueOnce(fresh)
    b.setBinding({ id: AssistantConversationId('other-binding'), profileId: AssistantProfileId('other'),
      rootSessionId: sid, createdAt: 1, updatedAt: 1 })
    await b.launcher.start(profile.id)
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: workspace.workspaceId })
    expect(b.bind).toHaveBeenCalledExactlyOnceWith(profile.id, { rootSessionId: fresh })
  })

  it('rejects a mismatched Host binding before navigation', async () => {
    const b = bench(true)
    b.bind.mockResolvedValueOnce({ id: AssistantConversationId('mismatch'), profileId: AssistantProfileId('foreign'),
      rootSessionId: sid, createdAt: 1, updatedAt: 1 })
    await expect(b.launcher.start(profile.id)).rejects.toThrow('does not match')
    expect(b.open).not.toHaveBeenCalled()
  })

  it('does not bind a Session that stopped being blank while its identity was being checked', async () => {
    const b = bench(true)
    const fresh = SessionId('fresh-after-race')
    b.create.mockResolvedValueOnce(fresh)
    b.read.mockImplementationOnce(async () => {
      b.sessions.update((state) => { const row = state.byId[sid]; if (row) row.blank = false })
      return undefined
    })
    await b.launcher.start(profile.id)
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: workspace.workspaceId })
    expect(b.bind).toHaveBeenCalledExactlyOnceWith(profile.id, { rootSessionId: fresh })
  })

  it('keeps ordinary sessions without an assistant badge', async () => {
    const b = bench(true)
    render(<AssistantIdentityDock sessionId={sid} loadConversation={b.read} loadProfile={b.loadProfile} t={makeTranslate(zh)} />)
    await act(async () => {})
    expect(b.read).toHaveBeenCalledWith(sid)
    expect(b.loadProfile).not.toHaveBeenCalled()
    expect(screen.queryByTestId('assistant-conversation-identity')).toBeNull()
  })

  it('suppresses navigation when disposed during Session creation', async () => {
    const b = bench(true)
    let finish!: (value: typeof sid) => void
    b.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = b.launcher.start(profile.id, true)
    await vi.waitFor(() => { expect(finish).toBeDefined() })
    b.launcher.dispose()
    finish(sid)
    await pending
    expect(b.bind).not.toHaveBeenCalled()
    expect(b.open).not.toHaveBeenCalled()
  })
})


describe('Switching to ordinary conversation', () => {
  it('clears an unused binding in the same Session without creating another Session', async () => {
    const b = bench(true)
    await b.launcher.start(profile.id)
    await b.launcher.useOrdinary(sid)
    expect(b.clear).toHaveBeenCalledExactlyOnceWith(sid)
    expect(await b.read()).toBeUndefined()
    expect(b.create).not.toHaveBeenCalled()
  })

  it('starts an ordinary Session in the same Workspace while preserving existing history', async () => {
    const b = bench(true)
    await b.launcher.start(profile.id)
    const snapshot = b.sessions.getSnapshot()
    b.sessions.set({ ...snapshot, byId: { [sid]: { ...snapshot.byId[sid]!, blank: false } } })
    const next = SessionId('ordinary-session')
    b.create.mockResolvedValue(next)
    await b.launcher.useOrdinary(sid)
    expect(b.clear).not.toHaveBeenCalled()
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: workspace.workspaceId })
    expect(b.open).toHaveBeenLastCalledWith(next)
    expect(await b.read()).toBeDefined()
    expect(b.bind).toHaveBeenCalledTimes(1)
  })
})
