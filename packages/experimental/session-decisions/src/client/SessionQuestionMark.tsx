/**
 * Sidebar Session-row question mark: the row's leading indicator that this
 * Session has an open structured question. The mark reads the shared
 * Remote-backed source through the row's own Session id; it activates nothing
 * and never reads a Session log.
 */
import { useEffect, useState } from 'react'
import { IconQuestionOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { pickOpenQuestion } from './questions-state.ts'
import type { QuestionSource } from './questions-source.ts'
import { NS } from './locales.ts'
import css from './QuestionCard.module.css'

/** Injected share of the Session-row question mark. */
export interface SessionQuestionMarkInjected {
  /** One source shared by the card, the Session-row mark, and the tool card. */
  readonly source: QuestionSource
  /** Shared invalidation tick; the renderer binds it to the `useRefresh` hook. */
  readonly hooks: { readonly refresh: QuestionSource['hooks']['refresh'] }
}

/** Full props of the Session-row question mark. */
export type SessionQuestionMarkProps =
  PropsRuntime<'sidebar.session.row.leading'> & PropsLocale<typeof NS> & InjectFace<SessionQuestionMarkInjected>

/**
 * Render the mark while this Session has an open question.
 * @param props.sessionId - Session this row shows.
 * @param props.source - shared Remote-backed source.
 * @param props.useRefresh - selector hook over the shared invalidation tick.
 * @param props.t - locale seat.
 * @returns the mark, or nothing while the read is unresolved, failed, or empty.
 */
export function SessionQuestionMark({
  sessionId, source, useRefresh, t,
}: SessionQuestionMarkProps) {
  const tick = useRefresh(value => value)
  const [present, setPresent] = useState(false)
  useEffect(() => {
    let alive = true
    source.catalog(sessionId)
      .then((views) => { if (alive) setPresent(pickOpenQuestion(views) !== undefined) })
      .catch(() => { if (alive) setPresent(false) })
    return () => { alive = false }
  }, [source, sessionId, tick])
  if (!present) return null
  return (
    <span
      className={css.mark}
      data-session-question-mark=''
      // A press on the mark must not activate the Session through the row's
      // own click target; the row keeps every other cell as its activation area.
      onClick={(event) => { event.stopPropagation() }}
    >
      <IconQuestionOutlineRegular size={14} />
      {/* The glyph is aria-hidden, so the state reaches assistive technology
          only through this label, as the row's status dots do. */}
      <span className={css.markLabel}>{t('markAria')}</span>
    </span>
  )
}
