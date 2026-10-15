/** Standing-team discussion submission, cancellation and committed public transcript. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CreateGroupDiscussionOptions,
  GroupDiscussion,
  GroupDiscussionId,
  GroupRoundId,
  GroupRoundJournalEntry,
  GroupTranscriptMessage,
  QueryPublicTranscriptOptions,
  QueryPublicTranscriptResult,
  ScheduleRoundOptions,
  TeamDefinition,
} from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import type { AssistantLocaleKey } from './locales.ts'
import css from './TeamDiscussion.module.css'

/** Real Host operations used by the discussion entry; provisioning is explicit submission only. */
export interface TeamDiscussionOps {
  readonly listDiscussions: (teamId: TeamDefinition['id']) => Promise<readonly GroupDiscussion[]>
  readonly createDiscussion: (options: CreateGroupDiscussionOptions) => Promise<GroupDiscussion>
  readonly provisionTeam: (teamId: TeamDefinition['id']) => Promise<{ readonly coordinatorSessionId: SessionId }>
  readonly scheduleRound: (options: ScheduleRoundOptions) => Promise<GroupRoundJournalEntry>
  readonly startRound: (roundId: GroupRoundId) => Promise<GroupRoundJournalEntry>
  readonly getRound: (roundId: GroupRoundId) => Promise<GroupRoundJournalEntry | undefined>
  readonly cancelRound: (roundId: GroupRoundId, reason?: string) => Promise<GroupRoundJournalEntry>
  readonly queryPublicTranscript: (options: QueryPublicTranscriptOptions) => Promise<QueryPublicTranscriptResult>
}

/** Team identity, localized copy, and the complete discussion capability. */
export interface TeamDiscussionProps {
  readonly team: TeamDefinition
  readonly operations?: TeamDiscussionOps | undefined
  readonly onProvisioned?: (() => Promise<void>) | undefined
  readonly t: (key: AssistantLocaleKey) => string
}

function running(round: GroupRoundJournalEntry | undefined): boolean {
  return round?.status === 'pending' || round?.status === 'active'
}

/**
 * Read committed discussion history and submit explicit user-authored team tasks.
 * @param props - team, complete Host operations, and localized copy.
 * @returns task composer, cancellable round status, and real public replies.
 */
export function TeamDiscussion({ team, operations, onProvisioned, t }: TeamDiscussionProps) {
  const [messages, setMessages] = useState<readonly GroupTranscriptMessage[]>([])
  const [round, setRound] = useState<GroupRoundJournalEntry>()
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [failed, setFailed] = useState<'read' | 'operation'>()
  const [hasMore, setHasMore] = useState(false)
  const discussion = useRef<GroupDiscussion | undefined>(undefined)
  const cursor = useRef<string | undefined>(undefined)
  const generation = useRef(0)
  const roundEpoch = useRef(0)
  const submittingRef = useRef(false)
  const readPending = useRef(new Set<number>())
  const roundRef = useRef(round)
  roundRef.current = round

  const readTranscript = useCallback(
    async (id: GroupDiscussionId, scope: number) => {
      if (!operations || readPending.current.has(scope)) return
      readPending.current.add(scope)
      try {
        const page = await operations.queryPublicTranscript({
          discussionId: id,
          teamId: team.id,
          limit: 100,
          ...(cursor.current ? { cursor: cursor.current } : {}),
        })
        if (scope !== generation.current) return
        const last = page.items.at(-1)
        if (last) cursor.current = last.id
        setMessages(current => [...new Map([...current, ...page.items].map(message => [message.id, message])).values()])
        setHasMore(page.hasMore)
        return last?.roundId
      } finally {
        readPending.current.delete(scope)
      }
    },
    [operations, team.id],
  )

  const readSnapshot = useCallback(async () => {
    const scope = generation.current
    const epoch = roundEpoch.current
    if (!operations) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await operations.listDiscussions(team.id)
      if (scope !== generation.current) return
      const selected = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      discussion.current = selected
      if (selected) {
        const latest = await readTranscript(selected.id, scope)
        const roundId = selected.activeRoundId ?? latest ?? roundRef.current?.id
        if (roundId) {
          const current = await operations.getRound(roundId)
          if (scope === generation.current && epoch === roundEpoch.current) setRound(current)
        }
      }
      if (scope === generation.current) setFailed(undefined)
    } catch {
      if (scope === generation.current) setFailed('read')
    } finally {
      if (scope === generation.current) setLoading(false)
    }
  }, [operations, team.id, readTranscript])

  useEffect(() => {
    generation.current++
    discussion.current = undefined
    cursor.current = undefined
    setMessages([])
    setRound(undefined)
    roundRef.current = undefined
    setDraft('')
    setHasMore(false)
    void readSnapshot()
    return () => {
      generation.current++
    }
  }, [readSnapshot])

  useEffect(() => {
    if (!operations || !round || !running(round)) return
    const scope = generation.current
    const roundId = round.id
    let pending = false
    let alive = true
    const refresh = async () => {
      if (pending) return
      pending = true
      const epoch = roundEpoch.current
      try {
        const current = await operations.getRound(roundId)
        if (!alive || scope !== generation.current || epoch !== roundEpoch.current) return
        if (!current) throw new Error('Round is no longer available')
        if (discussion.current) await readTranscript(discussion.current.id, scope)
        if (alive && scope === generation.current && epoch === roundEpoch.current) {
          setRound(current)
          setFailed(undefined)
        }
      } catch {
        if (alive && scope === generation.current && epoch === roundEpoch.current) setFailed('read')
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 1500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [operations, round?.id, round?.status, readTranscript])

  const submit = async () => {
    if (!operations || loading || !draft.trim() || submittingRef.current || running(round)) return
    submittingRef.current = true
    roundEpoch.current++
    const scope = generation.current
    const prompt = draft.trim()
    setSubmitting(true)
    setFailed(undefined)
    try {
      const allocation = await operations.provisionTeam(team.id)
      if (scope !== generation.current) return
      let selected = discussion.current
      if (!selected) {
        selected = await operations.createDiscussion({ teamId: team.id, rootSessionId: allocation.coordinatorSessionId, title: team.name })
        if (scope !== generation.current) return
        discussion.current = selected
      }
      const admitted = await operations.scheduleRound({ teamId: team.id, discussionId: selected.id, prompt })
      if (scope === generation.current) setRound(admitted)
      const started = await operations.startRound(admitted.id)
      if (scope !== generation.current) return
      setRound(started)
      setDraft('')
      await readTranscript(selected.id, scope)
      if (onProvisioned) {
        try {
          await onProvisioned()
        } catch {
          if (scope === generation.current) setFailed('read')
        }
      }
    } catch {
      if (scope === generation.current) setFailed('operation')
    } finally {
      submittingRef.current = false
      if (scope === generation.current) setSubmitting(false)
    }
  }

  const stop = async () => {
    if (!operations || !round || stopping) return
    const scope = generation.current
    roundEpoch.current++
    setStopping(true)
    try {
      const cancelled = await operations.cancelRound(round.id)
      if (scope === generation.current) {
        roundRef.current = cancelled
        setRound(cancelled)
        setFailed(undefined)
      }
      if (discussion.current) await readTranscript(discussion.current.id, scope)
    } catch {
      if (scope === generation.current) setFailed('operation')
    } finally {
      if (scope === generation.current) setStopping(false)
    }
  }

  const executionFailed =
    round?.status === 'failed' ||
    round?.slots.some(slot => slot.status === 'failed' || slot.status === 'uncertain' || slot.status === 'timed_out')
  return (
    <section className={css.panel} data-testid="team-discussion" aria-busy={loading}>
      {(!operations || failed === 'read') && <p role="alert">{t('discussionReadFailed')}</p>}
      {failed === 'operation' && <p role="alert">{t('operationFailed')}</p>}
      {executionFailed && <p role="alert">{t('discussionFailed')}</p>}
      <div className={css.toolbar}>
        {running(round) && <span role="status">{t('discussionRunning')}</span>}
        {operations && (
          <button
            type="button"
            className={css.button}
            onClick={() => {
              void readSnapshot()
            }}
            disabled={loading}
          >
            {t('discussionRefresh')}
          </button>
        )}
      </div>
      {round?.prompt && <p className={css.prompt}>{round.prompt}</p>}
      {!loading && messages.length === 0 && operations && !failed && <p className={css.empty}>{t('emptyDiscussion')}</p>}
      <ol className={css.messages}>
        {messages.map(message => (
          <li
            key={message.id}
            className={css.message}
            data-source-session={message.sourceSessionId}
            data-source-event-seq={message.sourceEventSeq}
          >
            <strong>{message.authorName}</strong>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
      {hasMore && operations && discussion.current && (
        <button
          type="button"
          className={css.button}
          onClick={() => {
            const selected = discussion.current
            if (selected)
              void readTranscript(selected.id, generation.current).catch(() => {
                setFailed('read')
              })
          }}
        >
          {t('discussionLoadMore')}
        </button>
      )}
      <form
        className={css.composer}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label htmlFor={`team-prompt-${team.id}`}>{t('discussionPrompt')}</label>
        <textarea
          id={`team-prompt-${team.id}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          placeholder={t('discussionPlaceholder')}
          disabled={!operations || submitting || running(round)}
        />
        <div className={css.actions}>
          {running(round) && (
            <button
              type="button"
              className={css.button}
              onClick={() => {
                void stop()
              }}
              disabled={stopping}
            >
              {t('discussionCancel')}
            </button>
          )}
          <button type="submit" className={css.button} disabled={!operations || loading || !draft.trim() || submitting || running(round)}>
            {t('discussionSend')}
          </button>
        </div>
      </form>
    </section>
  )
}
