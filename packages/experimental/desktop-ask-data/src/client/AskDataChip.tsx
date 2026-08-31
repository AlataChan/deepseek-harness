/**
 * New-session chip that opens the ask-data gate with a held data-agent stage.
 * Geometry matches the workspace and agent-preset chips in the same row.
 */

import type { AskDataKey } from './locales.ts'
import css from './AskDataChip.module.css'

/** Actions the chip needs from the conversation-scoped seat. */
export interface AskDataChipInjected {
  /** Stage data-agent without applying, then occupy the gate. */
  openGate: () => void
}

/** Chip props: locale plus the gate opener. */
export interface AskDataChipProps extends AskDataChipInjected {
  t: (key: AskDataKey) => string
}

/**
 * Render the 问数 hero chip.
 * @param props - locale and opener.
 * @returns the chip button.
 */
export function AskDataChip({ openGate, t }: AskDataChipProps) {
  return (
    <button type="button" className={css.chip} onClick={openGate}>
      {t('chip')}
    </button>
  )
}
