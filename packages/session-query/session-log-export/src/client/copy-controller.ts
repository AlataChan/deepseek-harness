/**
 * Browser controller for the Session Header's "Copy Session as Markdown" action. One
 * plugin instance owns one pending copy: the clipboard is a browser-wide
 * destination, so a second request joins the pending operation instead of
 * racing it.
 *
 * The prepared transcript is written through `writeClipboard`, the shared
 * primitive that owns the host clipboard path. Disposal aborts the read and
 * suppresses a late write or notice. A write the host already accepted cannot
 * be rolled back.
 * @module
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { SESSION_MARKDOWN_EXPORT_ROUTE } from '../routes.ts'

/** Whether the latest copy attempt succeeded, prepared no transcript, or could not write. */
export type SessionMarkdownCopyNoticeKind = 'success' | 'preparationFailed' | 'clipboardFailed'

/** One settled copy notice; `seq` keys the toast so a repeat copy restarts it. */
export interface SessionMarkdownCopyNotice {
  readonly kind: SessionMarkdownCopyNoticeKind
  readonly seq: number
}

/** Copy state shared by every Header row and the root overlay toast. */
export interface SessionMarkdownCopyState {
  /** Whether this plugin instance has a copy operation still pending. */
  copying: boolean
  /** Latest settled copy notice, or null while none shows. */
  notice: SessionMarkdownCopyNotice | null
}

/** Host clipboard writer used after the transcript is prepared. */
export interface SessionMarkdownClipboard {
  /**
   * Write prepared text. False means the host rejected the write.
   * @param text - the complete Markdown transcript.
   * @returns whether the host accepted the write.
   */
  writeText(text: string): Promise<boolean>
}

/** HTTP carrier for the Markdown route. */
type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

const INITIAL: SessionMarkdownCopyState = { copying: false, notice: null }

const browserClipboard: SessionMarkdownClipboard = {
  writeText: writeClipboard,
}

/** Owns the one pending Markdown copy for this plugin instance. */
export class SessionMarkdownCopyController {
  /** uSES-safe state source shared by every Header row and the overlay toast. */
  readonly store: SnapshotStore<SessionMarkdownCopyState> = createSnapshotStore(INITIAL)

  private pending: { readonly abort: AbortController; readonly done: Promise<void> } | undefined
  private disposed = false
  private noticeSeq = 0

  constructor(
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
    private readonly clipboard: SessionMarkdownClipboard = browserClipboard,
  ) {}

  /**
   * Copy one Session's complete transcript. A request received while a copy is
   * pending joins that operation and keeps its originally captured Session.
   * @param sessionId - Session captured by the click.
   * @returns after the clipboard work settles, a failure notice is published, or a late post-disposal request is ignored.
   */
  copy(sessionId: SessionId): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pending !== undefined) return this.pending.done
    const abort = new AbortController()
    const done = this.run(sessionId, abort.signal).finally(() => {
      this.pending = undefined
    })
    this.pending = { abort, done }
    return done
  }

  /** Clear the shown toast without affecting a pending copy. */
  dismiss(): void {
    if (this.store.getSnapshot().notice === null) return
    this.store.update((state) => { state.notice = null })
  }

  /**
   * Abort a pending read, suppress a late clipboard write or notice, and reach
   * quiescence. A write already accepted by the host cannot be undone.
   * @returns after the pending operation and any admitted clipboard work settle.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending = this.pending
    pending?.abort.abort()
    await pending?.done
    this.store.set(INITIAL)
  }

  private async run(sessionId: SessionId, signal: AbortSignal): Promise<void> {
    this.store.update((state) => { state.copying = true })
    try {
      let markdown: string
      try {
        markdown = await this.prepare(sessionId, signal)
      } catch (error: unknown) {
        // Disposal already cancelled the read; any other failure is a preparation notice.
        void error
        if (!this.isCancelled()) this.publishNotice('preparationFailed')
        return
      }
      if (this.isCancelled()) return
      let accepted = false
      try {
        accepted = await this.clipboard.writeText(markdown)
      } catch (error: unknown) {
        // A throwing writer is the same outcome as a rejected write.
        void error
        accepted = false
      }
      if (this.isCancelled()) return
      this.publishNotice(accepted ? 'success' : 'clipboardFailed')
    } finally {
      this.store.update((state) => { state.copying = false })
    }
  }

  private async prepare(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    const query = new URLSearchParams({ sessionId })
    const route = `${SESSION_MARKDOWN_EXPORT_ROUTE}?${query.toString()}`
    const response = await this.fetcher(route, { signal })
    if (!response.ok) throw new Error(`Session Markdown request failed: HTTP ${String(response.status)}`)
    return response.text()
  }

  private isCancelled(): boolean {
    return this.disposed
  }

  private publishNotice(kind: SessionMarkdownCopyNoticeKind): void {
    this.store.update((state) => {
      state.notice = { kind, seq: ++this.noticeSeq }
    })
  }
}
