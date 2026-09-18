/**
 * Hero chip: unbound label is 知识库; bound label is the library name.
 */

import { IconFolderOpenOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AskKnowledgeKey } from './locales.ts'
import { libraryHueIndex, libraryInitial } from './library-initial.ts'
import css from './AskKnowledgeChip.module.css'

/** Actions the chip needs from the conversation-scoped seat. */
export interface AskKnowledgeChipInjected {
  /** Toggle the library picker. Does not occupy the ask-data gate. */
  openPicker: () => void
  /** Hung library name, or undefined when unbound. */
  boundName?: string | undefined
}

/** Chip props: locale plus opener and bind label. */
export interface AskKnowledgeChipProps extends AskKnowledgeChipInjected {
  t: (key: AskKnowledgeKey) => string
}

const HUE_CLASS = [css.hue0, css.hue1, css.hue2] as const

/**
 * Render the 问知识 hero chip.
 * @param props - locale, opener, and optional bound name.
 * @returns the chip button.
 */
export function AskKnowledgeChip({ openPicker, boundName, t }: AskKnowledgeChipProps) {
  const label = boundName ?? t('chip.unbound')
  return (
    <button type="button" className={css.chip} aria-label={label} onClick={openPicker}>
      {boundName === undefined
        ? <IconFolderOpenOutline16 size={14} className={css.mark} />
        : (
          <span className={`${css.avatar} ${HUE_CLASS[libraryHueIndex(boundName)]}`} aria-hidden>
            {libraryInitial(boundName)}
          </span>
        )}
      <span className={css.label}>{label}</span>
    </button>
  )
}
