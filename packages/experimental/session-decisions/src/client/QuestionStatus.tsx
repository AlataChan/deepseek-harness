/**
 * Status line of the persistent-questions card: the truthful display state of
 * one record, rendered from the state discriminant {@link deriveStatus}
 * produced. Presentation only; every state copy is locale-owned.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuestionStatusKind } from './questions-state.ts'
import { NS } from './locales.ts'
import css from './QuestionStatus.module.css'

/** Which status keys resolve through the shared dictionary. */
const STATUS_KEYS: Record<Exclude<QuestionStatusKind, 'active'>, Parameters<QuestionStatusProps['t']>[0]> = {
  paused: 'paused',
  expired: 'expired',
  cancelled: 'cancelled',
  superseded: 'superseded',
  submitting: 'submitting',
  admitted: 'admitted',
  needs_reconciliation: 'needsReconciliation',
  withdrawn: 'withdrawn',
  dismissed: 'dismissed',
}

/** Full props of the status line. */
export interface QuestionStatusProps extends PropsLocale<typeof NS> {
  /** Display state discriminant. */
  readonly kind: QuestionStatusKind
}

/**
 * Render the localized status line for one display state; an active question
 * presents its answer form instead of a status line.
 * @param props.kind - display state.
 * @param props.t - locale seat.
 * @returns the status line, or nothing while the question is active.
 */
export function QuestionStatus({ kind, t }: QuestionStatusProps) {
  if (kind === 'active') return null
  return (
    <p className={css.status} data-status={kind}>
      {t(STATUS_KEYS[kind])}
    </p>
  )
}
