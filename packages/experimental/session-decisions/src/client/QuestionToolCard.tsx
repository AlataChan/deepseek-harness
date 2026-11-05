/**
 * Conversation tool card for the persistent-question tools: a raw-result-driven
 * presentation keyed on the wire tool names. The persisted tool result carries
 * only `{ decisionId, revision }`; the card fetches the actual Remote-backed
 * record and renders its server-owned state instead of assistant prose. A
 * result without a parsable pointer presents the truthful invalid-copy state.
 */
import { useEffect, useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DecisionId, DecisionView } from '../types.ts'
import type { QuestionSource } from './questions-source.ts'
import { QuestionStatus } from './QuestionStatus.tsx'
import { deriveStatus } from './questions-state.ts'
import { NS } from './locales.ts'
import css from './QuestionCard.module.css'

/** Injected share of the question tool card. */
export interface QuestionToolCardInjected {
  /** One source shared by the card, the Session-row mark, and the tool card. */
  readonly source: QuestionSource
  /** Shared invalidation tick; the renderer binds it to the `useRefresh` hook. */
  readonly hooks: { readonly refresh: QuestionSource['hooks']['refresh'] }
}

/** Full props of the question tool card. */
export type QuestionToolCardProps =
  ToolCallViewProps & PropsLocale<typeof NS> & InjectFace<QuestionToolCardInjected>

/** The persisted presenter pointer of a settled question tool result. */
function resultPointer(meta: unknown): { decisionId: DecisionId; revision: number } | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const candidate = meta as { decisionId?: unknown; revision?: unknown }
  if (typeof candidate.decisionId !== 'string' || candidate.decisionId.length === 0) return undefined
  if (typeof candidate.revision !== 'number' || !Number.isInteger(candidate.revision)) return undefined
  return { decisionId: candidate.decisionId as DecisionId, revision: candidate.revision }
}

/** Question tool card for one settled `request_persistent_question` result. */
export function QuestionToolCard({
  phase, block, source, useRefresh, t,
}: QuestionToolCardProps) {
  const [view, setView] = useState<DecisionView | undefined | 'invalid'>(undefined)
  const tick = useRefresh(value => value)
  const pointer = phase === 'result' ? resultPointer(block.meta) : undefined
  useEffect(() => {
    if (phase !== 'result') {
      // A non-result phase paints nothing: no pointer exists yet, and the
      // invalid copy must never leak into preparing or start on a card
      // instance that later reaches its result.
      setView(undefined)
      return undefined
    }
    if (pointer === undefined) {
      setView('invalid')
      return undefined
    }
    let alive = true
    // Starting the fetch shows the loading line until the record or a real
    // read failure arrives, never the invalid copy.
    setView(undefined)
    source.get(pointer.decisionId)
      .then((record) => { if (alive) setView(record ?? 'invalid') })
      .catch(() => { if (alive) setView('invalid') })
    return () => { alive = false }
  }, [source, phase, pointer?.decisionId, tick])
  if (phase !== 'result') return null
  if (view === undefined) {
    return <p className={css.meta} data-question-tool=''>{t('loading')}</p>
  }
  if (view === 'invalid') {
    return <p className={css.failure} data-question-tool=''>{t('toolMetaInvalid')}</p>
  }
  return (
    <div className={css.tool} data-question-tool=''>
      <p className={css.question}>{view.question}</p>
      <QuestionStatus kind={deriveStatus(view, Date.now())} t={t} />
    </div>
  )
}
