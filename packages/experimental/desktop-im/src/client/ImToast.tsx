/** Settings-operation notifications outlive the settings section. */
import { useSyncExternalStore } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImLocaleKey } from './locales.ts'

/** One plugin-lifetime notification source shared by settings actions and the shell overlay. */
export class ImNotices {
  private current: { key: ImLocaleKey; sequence: number } | null = null
  private sequence = 0
  private readonly listeners = new Set<() => void>()
  /** Read the notification snapshot.
   * @returns Current notification, stable until changed.
   */
  snapshot = () => this.current
  /**
   * Observe notification changes.
   * @param listener - React observer.
   * @returns Observer removal.
   */
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /** Display a localized operation outcome.
   * @param key - Locale-owned notification.
   */
  show(key: ImLocaleKey): void { this.current = { key, sequence: ++this.sequence }; for (const listener of this.listeners) listener() }
  /** Dismiss one notification without clearing a newer outcome.
   * @param sequence - Notification being dismissed.
   */
  clear(sequence: number): void {
    if (this.current?.sequence === sequence) {
      this.current = null
      for (const listener of this.listeners) listener()
    }
  }
}

/**
 * Render a shell-owned operation notification.
 * @param props - Plugin-lifetime notification source and locale.
 * @returns App-wide transient operation feedback.
 */
export function ImToast({ notices, t }: { notices: ImNotices } & PropsLocale<'desktop-im'>) {
  const notice = useSyncExternalStore(notices.subscribe, notices.snapshot)
  return notice ? <Toast key={notice.sequence} text={t(notice.key)} {...(notice.key === 'failed' ? {} : { tone: 'success' as const })} onDone={() =>{  notices.clear(notice.sequence) }} /> : null
}
