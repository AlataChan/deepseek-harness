/**
 * New-session chip that opens the ask-data gate with a held data-agent stage.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
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
    <Button className={css.chip} variant="outline" size="sm" onClick={openGate}>
      {t('chip')}
    </Button>
  )
}
