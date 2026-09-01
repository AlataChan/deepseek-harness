/**
 * Hero chip: unbound label is 知识库; bound label is the library name.
 */

import type { AskKnowledgeKey } from './locales.ts'
import css from './AskKnowledgeChip.module.css'

/** Actions the chip needs from the conversation-scoped seat. */
export interface AskKnowledgeChipInjected {
  /** Open the library picker. Does not occupy the ask-data gate. */
  openPicker: () => void
  /** Hung library name, or undefined when unbound. */
  boundName?: string | undefined
}

/** Chip props: locale plus opener and bind label. */
export interface AskKnowledgeChipProps extends AskKnowledgeChipInjected {
  t: (key: AskKnowledgeKey) => string
}

/**
 * Render the 问知识 hero chip.
 * @param props - locale, opener, and optional bound name.
 * @returns the chip button.
 */
export function AskKnowledgeChip({ openPicker, boundName, t }: AskKnowledgeChipProps) {
  return (
    <button type="button" className={css.chip} onClick={openPicker}>
      {boundName ?? t('chip.unbound')}
    </button>
  )
}
