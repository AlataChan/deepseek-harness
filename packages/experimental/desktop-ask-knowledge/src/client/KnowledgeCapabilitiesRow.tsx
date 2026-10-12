/**
 * 问知识 row inside the hero 专业能力 menu: opens the knowledge-library
 * picker and closes the menu first.
 */

import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AskKnowledgeKey } from './locales.ts'

/** Actions the row needs from its registrant. */
export interface KnowledgeCapabilitiesRowInjected {
  /** Open the knowledge-library picker. */
  openPicker: () => void
}

/** Full props of the 问知识 row. */
export type KnowledgeCapabilitiesRowProps =
  PropsRuntime<'conversation.hero.capabilities.item'>
  & InjectFace<KnowledgeCapabilitiesRowInjected>
  & { t: (key: AskKnowledgeKey) => string }

/**
 * Render the 问知识 row.
 * @param props - injected picker opener, the menu's close seat, and locale.
 * @returns the menu row.
 */
export function KnowledgeCapabilitiesRow({ openPicker, close, t }: KnowledgeCapabilitiesRowProps) {
  return (
    <MenuItemButton
      onSelect={() => {
        close()
        openPicker()
      }}
    >
      {t('chip.unbound')}
    </MenuItemButton>
  )
}
