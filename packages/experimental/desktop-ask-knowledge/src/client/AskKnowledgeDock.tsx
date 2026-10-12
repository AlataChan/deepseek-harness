/**
 * Composer dock entry: the hung knowledge library, plus the documents picked
 * for this session. Renders as the standalone strip above the composer card;
 * the picker reopens from the change action.
 */

import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { documentLabel } from './LibraryPicker.tsx'
import css from './AskKnowledgeDock.module.css'

/** Documents picked in one picker gesture, keyed by Session id. */
export type AskKnowledgeSelection = Record<string, readonly string[] | undefined>

/** Actions and sources the dock needs. */
export interface AskKnowledgeDockInjected {
  /** Reopen the library picker to change the hung library. */
  openPicker: () => void
  hooks: {
    /** Documents picked through the picker, keyed by Session id. */
    askKnowledgeSelection: SnapshotStore<AskKnowledgeSelection>
  }
}

/** Dock props: input-zone owner share, injected actions, and locale. */
export type AskKnowledgeDockProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<AskKnowledgeDockInjected>
  & PropsLocale<'desktop-ask-knowledge'>

/**
 * Render the knowledge dock while this Session has a hung library.
 * @param props - owner share, injected actions and selection source, locale.
 * @returns the dock strip, or null while unbound.
 */
export function AskKnowledgeDock({
  useProjection, useAskKnowledgeSelection, sessionId, openPicker, t,
}: AskKnowledgeDockProps) {
  const binding = useProjection('askKnowledgeBinding')
  const picked = useAskKnowledgeSelection(next => next[String(sessionId)])
  if (binding == null) return null
  const docs = picked === undefined || picked.length === 0
    ? undefined
    : picked.length === 1
      ? t('dock.docsOne', { name: documentLabel(picked[0] ?? '') })
      : t('dock.docsMany', { name: documentLabel(picked[0] ?? ''), count: picked.length - 1 })
  return (
    <div className={css.dock}>
      <div className={css.bar}>
        <span className={css.label}>{t('dock.title')}</span>
        <span className={css.name}>{binding.displayName}</span>
        {docs === undefined ? null : <span className={css.docs}>{docs}</span>}
        <button type="button" className={css.change} onClick={openPicker}>
          {t('dock.change')}
        </button>
      </div>
    </div>
  )
}
