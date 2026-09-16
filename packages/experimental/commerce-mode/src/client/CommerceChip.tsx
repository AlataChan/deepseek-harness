/**
 * New-session chip that opens the commerce gate with a held commerce stage.
 * Geometry matches the workspace, agent-preset, and ask-data chips in the same row.
 */

import type { CommerceKey } from './locales.ts'
import css from './CommerceChip.module.css'

/** Actions the chip needs from the conversation-scoped seat. */
export interface CommerceChipInjected {
  /** Stage the commerce preset without applying, then occupy the gate. */
  openGate: () => void
}

/** Chip props: locale plus the gate opener. */
export interface CommerceChipProps extends CommerceChipInjected {
  t: (key: CommerceKey) => string
}

/**
 * Render the 电商助手 hero chip.
 * @param props - locale and opener.
 * @returns the chip button.
 */
export function CommerceChip({ openGate, t }: CommerceChipProps) {
  return (
    <button type="button" className={css.chip} onClick={openGate}>
      {t('chip')}
    </button>
  )
}
