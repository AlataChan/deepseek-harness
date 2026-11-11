/**
 * Shared composer/header answer form for the Session's one
 * open structured question. The card reads the actual Remote-backed record,
 * submits the record's own saved identity with a 1-based choice ordinal or the
 * original free text, and presents only server-owned states; a duplicate click
 * while a submission is in flight does not send a second answer, and every
 * settled outcome re-reads the Host state instead of trusting an echoed
 * acceptance.
 *
 * The close and pause actions follow the actual Host mutation surface:
 * `cancel` closes an unreserved question, `dismiss` closes the tracking of an
 * unresolved in-flight answer, and `pause`/`resume` gate admission. A read or
 * action started for one Session never lands under another after switching.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconQuestionOutlineRegular,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DecisionView, RecordMutationOutcome } from '../types.ts'
import { closeActionFor, deriveStatus, pickOpenQuestion, type QuestionStatusKind } from './questions-state.ts'
import type { AnswerPayload, QuestionSource } from './questions-source.ts'
import { QuestionStatus } from './QuestionStatus.tsx'
import { NS, type QuestionLocaleKey } from './locales.ts'
import css from './QuestionCard.module.css'

/**
 * Server-recorded pause reason for a user-initiated pause: a stable wire
 * token, not product copy — the card never renders it.
 */
const PAUSE_REASON = 'user-requested'

const notificationLabels = {
  in_flight: 'notificationSending',
  sent: 'notificationSent',
  failed: 'notificationFailed',
  unknown: 'notificationUnknown',
} as const satisfies Record<NonNullable<DecisionView['notificationStatus']>, QuestionLocaleKey>

/** Injected share of the header question card: the shared Remote-backed source. */
export interface QuestionCardInjected {
  /** One source shared by the card, the Session-row mark, and the tool card. */
  readonly source: QuestionSource
  /** Shared invalidation tick; the renderer binds it to the `useRefresh` hook. */
  readonly hooks: { readonly refresh: QuestionSource['hooks']['refresh'] }
}

/** Full props of the Session-header question card. */
export type QuestionCardProps =
  PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & InjectFace<QuestionCardInjected> & {
    /** Keep the active answer form visible above the ordinary composer. */
    readonly inline?: boolean
  }

/** Answer form for one Session, inline above the composer or in its header popover. */
export function QuestionCard({
  sessionId, source, useRefresh, t, inline = false,
}: Pick<QuestionCardProps, 'sessionId' | 'source' | 'useRefresh' | 't' | 'inline'>) {
  const [open, setOpen] = useState(inline)
  // The record to present: an open question, or — until the panel closes — the
  // record the user just acted on, so its terminal state stays visible.
  const [view, setView] = useState<DecisionView | undefined>(undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [inflight, setInflight] = useState(false)
  const [note, setNote] = useState<'rejected' | 'failed' | undefined>(undefined)
  const [confirming, setConfirming] = useState<false | 'cancel' | 'dismiss'>(false)
  const [text, setText] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const lastViewRef = useRef<DecisionView | undefined>(undefined)
  // Monotonic operation identity: every read or action captures the counter
  // at its start and is discarded once a newer operation starts or the
  // Session switches, so a late same-Session catalog completion can never
  // overwrite a newer record and a settled old action can neither apply its
  // outcome nor release a newer action's lock. The active-action ref holds
  // the id of the one action owning `inflight`; reads never touch it.
  const seqRef = useRef(0)
  const activeActionRef = useRef<number | undefined>(undefined)
  const openRef = useRef(open)
  openRef.current = open
  const panelPosition = useAnchoredPosition({
    open: !inline && open, anchorRef: triggerRef, panelRef, side: 'bottom', gap: 5, margin: 16,
  })
  useDismissOnOutsidePointer(rootRef, !inline && open, setOpen, panelRef)

  /**
   * Re-read the Host state and derive the display status the read produced,
   * so a settled action can present a failure line only while the record it
   * acted on is still open and answerable. A post-action read is always
   * fresh: it must never resolve a cached pre-mutation promise.
   */
  const read = useCallback(async (present: boolean): Promise<QuestionStatusKind> => {
    const id = ++seqRef.current
    setStatus('loading')
    try {
      const views = await source.catalog(sessionId, { fresh: present })
      const openView = pickOpenQuestion(views)
      // The record the user acted on stays visible — with its terminal state —
      // while the panel is open, whatever the poll or refresh tick reads.
      const shown = openView
        ?? ((!inline && (present || openRef.current))
          ? views.find(candidate => candidate.decisionId === lastViewRef.current?.decisionId)
          : undefined)
      // Apply only while this is still the latest read; the derived status is
      // still returned, so the action that requested this read can decide its
      // failure line from what the fresh read actually observed.
      if (seqRef.current === id) {
        if (shown !== undefined) {
          lastViewRef.current = shown
          setView(shown)
          setStatus('ready')
        } else {
          setView(undefined)
          setStatus('ready')
        }
      }
      return shown !== undefined ? deriveStatus(shown, Date.now()) : 'active'
    } catch {
      if (seqRef.current !== id) return 'active'
      setStatus('error')
      return 'active'
    }
  }, [source, sessionId, inline])

  // Switching Sessions drops the previous Session's record, note, draft,
  // confirm step, and action lock at once, and discards every in-flight read
  // or action started for the previous Session. Declared before the read
  // effect below so the discard precedes the new Session's first read.
  useEffect(() => {
    seqRef.current += 1
    activeActionRef.current = undefined
    lastViewRef.current = undefined
    setView(undefined)
    setNote(undefined)
    setInflight(false)
    setConfirming(false)
    setText('')
  }, [sessionId])

  // The header seat reads on mount, on the shared refresh tick, and whenever
  // its panel closes (re-deriving the open-only trigger presence).
  const tick = useRefresh(value => value)
  useEffect(() => {
    void read(false)
  }, [read, tick])

  // Panel-open lifecycle: focus and expiry ticking while open, one re-read
  // when the panel closes. The initial closed mount reads through the tick
  // effect above; reopening after a close re-runs the close re-read already
  // consumed by that transition.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (wasOpenRef.current === open) return undefined
    wasOpenRef.current = open
    if (!open) {
      setConfirming(false)
      void read(false)
      return undefined
    }
  }, [open, read])

  useEffect(() => {
    if (!open || (inline && view === undefined)) return undefined
    setNow(Date.now())
    setConfirming(false)
    if (!inline) panelRef.current?.focus()
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [open, inline, view?.decisionId, sessionId])

  const submit = async (record: DecisionView, payload: AnswerPayload) => {
    if (activeActionRef.current !== undefined) return
    const action = ++seqRef.current
    activeActionRef.current = action
    setInflight(true)
    setNote(undefined)
    try {
      const outcome = await source.submit(record, payload)
      if (activeActionRef.current !== action) return
      const readStatus = await read(true)
      if (activeActionRef.current !== action) return
      // A typed rejection presents the failure line only while the record is
      // still open and answerable; otherwise the read already shows the
      // server-owned state the rejection resolved against. A settled
      // submission that the Host took in keeps nothing of the draft.
      if (outcome.outcome === 'rejected') {
        if (readStatus === 'active') setNote('rejected')
      } else {
        setText('')
      }
    } catch {
      if (activeActionRef.current !== action) return
      await read(true)
      if (activeActionRef.current !== action) return
      setNote('failed')
    } finally {
      if (activeActionRef.current === action) {
        activeActionRef.current = undefined
        setInflight(false)
      }
    }
  }

  /** Run one record mutation and re-read the Host state it settled against. */
  const mutate = async (record: DecisionView, run: (view: DecisionView) => Promise<RecordMutationOutcome>): Promise<void> => {
    if (activeActionRef.current !== undefined) return
    const action = ++seqRef.current
    activeActionRef.current = action
    setInflight(true)
    setNote(undefined)
    try {
      const outcome = await run(record)
      if (activeActionRef.current !== action) return
      await read(true)
      if (activeActionRef.current !== action) return
      // A refused mutation presents the failure line in whatever state the
      // fresh read landed on — paused, submitting, reconciliation, withdrawn,
      // or active — so the click the user just made is never silently
      // swallowed by a non-active record state.
      if (!outcome.ok) setNote('failed')
    } catch {
      if (activeActionRef.current !== action) return
      await read(true)
      if (activeActionRef.current !== action) return
      setNote('failed')
    } finally {
      if (activeActionRef.current === action) {
        activeActionRef.current = undefined
        setInflight(false)
      }
    }
  }

  if (inline && view === undefined) return null
  if (view === undefined && status !== 'error' && !(open && status === 'loading')) return null

  const panelStatus = view !== undefined ? deriveStatus(view, now) : 'active'
  const answerable = panelStatus === 'active' && !inflight
  const closeAction = view !== undefined && view.lifecycle === 'open' ? closeActionFor(view) : undefined
  const closeCopy = closeAction === 'cancel'
    ? { action: 'cancelQuestion', confirm: 'cancelConfirm', commit: 'confirmCancel' } as const
    : { action: 'stopTracking', confirm: 'stopTrackingConfirm', commit: 'confirmStop' } as const
  const closeButtons = view !== undefined && closeAction !== undefined && (confirming === false ? (
    <button
      type='button'
      className={css.secondary}
      disabled={inflight}
      onClick={() => { setConfirming(closeAction) }}
    >
      {t(closeCopy.action)}
    </button>
  ) : (
    <>
      <span className={css.confirm}>{t(closeCopy.confirm)}</span>
      <button
        type='button'
        className={css.secondary}
        disabled={inflight}
        onClick={() => {
          const action = closeAction
          setConfirming(false)
          void mutate(view, current => action === 'cancel' ? source.cancel(current) : source.dismiss(current))
        }}
      >
        {t(closeCopy.commit)}
      </button>
      <button type='button' className={css.secondary} onClick={() => { setConfirming(false) }}>
        {t('cancel')}
      </button>
    </>
  ))

  return (
    <div ref={rootRef} className={inline ? css.inlineRoot : css.root} data-session-question={inline ? '' : undefined}>
      {!inline && <button
        type='button'
        ref={triggerRef}
        className={css.trigger}
        aria-label={t('title')}
        aria-expanded={open}
        aria-haspopup='dialog'
        onClick={() => { setOpen(value => !value) }}
      >
        <IconQuestionOutlineRegular size={16} />
      </button>}
      {open && (
        <div
          ref={panelRef}
          role={inline ? 'group' : 'dialog'}
          aria-label={t('title')}
          tabIndex={inline ? undefined : -1}
          className={inline ? css.inlinePanel : css.panel}
          style={inline ? undefined : panelPosition ?? undefined}
          onKeyDown={(event) => {
            if (!inline && event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
              triggerRef.current?.focus()
            }
          }}
        >
          {view !== undefined ? (
            <>
              <p className={css.question}>{view.question}</p>
              <p className={css.meta}>{t('expiresAt', { time: formatTime(t, view.expiresAtUtc) })}</p>
              {/* Host-derived per read: only a live active-but-disarmed Goal
                  carries the flag, so no Goal and a truly paused phase stay
                  silent instead of promising a resume that cannot happen. */}
              {panelStatus === 'active' && view.goalDisarmed === true && <p className={css.hint}>{t('goalHint')}</p>}
              {view.notificationStatus !== undefined && <p className={css.hint}>{t(notificationLabels[view.notificationStatus])}</p>}
              <QuestionStatus kind={panelStatus} t={t} />
              {/* The failure line of the click the user just made shows in
                  whatever state the fresh read landed on. */}
              {note !== undefined && <p className={css.failure}>{t(note === 'failed' ? 'actionFailed' : 'rejected')}</p>}
              {panelStatus === 'active' && (
                <>
                  <div className={css.choices}>
                    {view.choices.map((label, index) => (
                      <button
                        key={`${index}-${label}`}
                        type='button'
                        className={css.choice}
                        disabled={!answerable}
                        onClick={() => { void submit(view, { choiceOrdinal: index + 1 }) }}
                      >
                        {/* Model-authored display data; rendered as text. */}
                        {label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className={css.text}
                    rows={2}
                    placeholder={t('answerPlaceholder')}
                    value={text}
                    disabled={!answerable}
                    onChange={(event) => { setText(event.target.value) }}
                  />
                  <div className={css.actions}>
                    <button
                      type='button'
                      className={css.send}
                      disabled={!answerable || text.trim().length === 0}
                      onClick={() => {
                        const payload = text
                        void submit(view, { text: payload })
                      }}
                    >
                      {t('send')}
                    </button>
                    <button
                      type='button'
                      className={css.secondary}
                      disabled={inflight}
                      onClick={() => { void mutate(view, current => source.pause(current, PAUSE_REASON)) }}
                    >
                      {t('pause')}
                    </button>
                    {closeButtons}
                  </div>
                </>
              )}
              {panelStatus === 'paused' && (
                <div className={css.actions}>
                  <button
                    type='button'
                    className={css.secondary}
                    disabled={inflight}
                    onClick={() => { void mutate(view, current => source.resume(current)) }}
                  >
                    {t('resume')}
                  </button>
                  {closeButtons}
                </div>
              )}
              {panelStatus !== 'active' && panelStatus !== 'paused' && closeAction !== undefined && (
                <div className={css.actions}>
                  {closeButtons}
                </div>
              )}
            </>
          ) : (
            <>
              <p className={css.meta}>{status === 'loading' ? t('loading') : t('loadFailed')}</p>
              {status === 'error' && (
                <button type='button' className={css.secondary} onClick={() => { void read(false) }}>{t('retry')}</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Localized wall-clock rendering of one persisted expiry timestamp, through
 * the dictionary's time template (the message-clock pattern): `toLocaleString`
 * would follow the browser language, not the app locale. */
function formatTime(t: QuestionCardProps['t'], utc: string): string {
  const date = new Date(utc)
  if (Number.isNaN(date.getTime())) return utc
  const pad2 = (value: number): string => String(value).padStart(2, '0')
  return t('expiresTimeFormat', {
    m: date.getMonth() + 1,
    d: date.getDate(),
    hh: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
  })
}
