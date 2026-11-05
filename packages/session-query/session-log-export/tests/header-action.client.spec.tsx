// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { useSyncExternalStore } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import type { SessionMarkdownCopyState } from '../src/client/copy-controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadHeaderProps } from '../src/client/HeaderAction.tsx'
import type {} from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSnapshot<State>(store: ObservableSnapshot<State>) {
  return function useSnapshot<T>(selector: (state: State) => T): T {
    return useSyncExternalStore(
      listener => store.subscribe(listener),
      () => selector(store.getSnapshot()),
    )
  }
}

function bench(feedbackAvailable = false, copying = false) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const copyMarkdown = vi.fn(async () => {})
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const openFeedback = vi.fn()
  const feedback = createSnapshotStore(feedbackAvailable)
  const copy = createSnapshotStore<SessionMarkdownCopyState>({ copying, notice: null })
  const useSessionLogDownload = bindSnapshot(controller.store)
  const props: SessionLogDownloadHeaderProps = {
    sessionId: SID,
    useSessions: () => { throw new Error('Session list is not used by this fixture') },
    useSessionStatus: () => { throw new Error('Session status is not used by this fixture') },
    useSessionRetainInfo: () => { throw new Error('Retain info is not used by this fixture') },
    usePanelInfo: () => { throw new Error('Panel info is not used by this fixture') },
    useWorkspaces: () => { throw new Error('Workspaces are not used by this fixture') },
    useTrajectory: () => { throw new Error('Trajectory is not used by this fixture') },
    useResource: () => { throw new Error('Resources are not used by this fixture') },
    useSession: () => { throw new Error('Session state is not used by the export Header') },
    useProjection: () => { throw new Error('Projections are not used by the export Header') },
    useInput: () => { throw new Error('Input state is not used by the export Header') },
    useConversation: () => { throw new Error('Conversation is not used by the export Header') },
    useChat: () => { throw new Error('Chat is not used by the export Header') },
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
      insertText: () => false, insertQuote: () => false, persistDraft: () => {}, setDraft: () => {},
      addAttachments: () => false, removeAttachment: () => {}, pruneAttachments: () => {}, submit: () => {},
    },
    useSessionLogDownload,
    useSessionMarkdownCopy: bindSnapshot(copy),
    useFeedbackAvailable: bindSnapshot(feedback),
    openFeedback,
    request,
    copyMarkdown,
    dismiss,
    t: makeTranslate(en),
  }
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, copyMarkdown, openFeedback, feedback, copy, view, props }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('opens Session feedback and closes the menu without starting a download', () => {
    const b = bench(true)
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('keeps export available without the feedback plugin', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
  })

  it('updates the open menu when feedback becomes available, unloads, and reloads', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()

    act(() => { b.feedback.set(true) })
    expect(b.view.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    act(() => { b.feedback.set(false) })
    expect(b.view.queryByRole('menuitem', { name: 'Feedback' })).toBeNull()
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()

    act(() => { b.feedback.set(true) })
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Feedback' }))
    expect(b.openFeedback).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('opens the more-actions menu and downloads through the shared controller', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'More actions' })
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Download session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('closes the menu on Escape without downloading', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(b.view.queryByRole('menuitem', { name: 'Download session log' })).toBeNull()
    expect(b.request).not.toHaveBeenCalled()
  })

  it('disables the download row while either entry path downloads this Session', async () => {
    const b = bench(true)
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSnapshot(controller.store)
    const props: SessionLogDownloadHeaderProps = {
      ...b.props,
      useSessionLogDownload,
      useSessionMarkdownCopy: bindSnapshot(b.copy),
      useFeedbackAvailable: bindSnapshot(b.feedback),
      openFeedback: b.openFeedback,
      request: (sessionId: SessionId) => controller.download(sessionId),
      copyMarkdown: b.copyMarkdown,
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: makeTranslate(en),
    }
    b.view.rerender(<SessionLogDownloadHeaderAction {...props} />)

    const download = controller.download(SID)
    const button = b.view.getByRole('button', { name: 'More actions' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    fireEvent.click(button)
    const item = b.view.getByRole('menuitem', { name: 'Download session log' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect((b.view.getByRole('menuitem', { name: 'Feedback' }) as HTMLButtonElement).disabled).toBe(false)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
    expect((item as HTMLButtonElement).disabled).toBe(false)
    expect((b.view.getByRole('menuitem', { name: 'Copy Session as Markdown' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('ports the open menu to document.body and still copies from a pointer click', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    const menu = b.view.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(b.view.container.contains(menu)).toBe(false)
    expect(b.view.getByRole('menuitem', { name: 'Download session log' })).toBeTruthy()
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Copy Session as Markdown' }))
    expect(b.copyMarkdown).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('copies through the menu without starting a download', () => {
    const b = bench()
    fireEvent.click(b.view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Copy Session as Markdown' }))
    expect(b.copyMarkdown).toHaveBeenCalledWith(SID)
    expect(b.request).not.toHaveBeenCalled()
    expect(b.view.queryByRole('menu')).toBeNull()
  })

  it('disables only the copy row and marks the button busy while a copy is pending', () => {
    const b = bench(true, true)
    const button = b.view.getByRole('button', { name: 'More actions' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect((b.view.getByRole('menuitem', { name: 'Copy Session as Markdown' }) as HTMLButtonElement).disabled).toBe(true)
    expect((b.view.getByRole('menuitem', { name: 'Download session log' }) as HTMLButtonElement).disabled).toBe(false)
    expect((b.view.getByRole('menuitem', { name: 'Feedback' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
