/**
 * Hero capabilities menu: one chip stacking 问数据, 问知识, and the media
 * creation shortcuts. Contributed rows arrive through the fork-owned
 * `conversation.hero.capabilities.item` slot so each capability package
 * renders its own entry.
 */

import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { AskDataKey } from './locales.ts'
import css from './CapabilitiesMenu.module.css'

/** The fork-owned item slot the menu stacks capability rows from. */
export const CAPABILITIES_ITEM_SLOT = 'conversation.hero.capabilities.item'

/** Owner props handed to every contributed row. */
export interface CapabilitiesItemOwnerProps {
  /** Close the menu before the row acts. */
  readonly close: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One contributed row inside the 专业能力 menu. */
    'conversation.hero.capabilities.item': {
      kind: 'list'
      scope: 'session-maybe'
      owner: CapabilitiesItemOwnerProps
    }
  }
}

/** Actions the menu needs from its registrant. */
export interface CapabilitiesMenuInjected {
  /** Open the ask-data gate. */
  openData: () => void
}

/** Full props of the hero capabilities menu. */
export type CapabilitiesMenuProps =
  PropsRuntime<'conversation.hero.askData'>
  & InjectFace<CapabilitiesMenuInjected>
  & PropsRenderSlots<typeof CAPABILITIES_ITEM_SLOT>
  & { t: (key: AskDataKey) => string }

/**
 * Render the capabilities chip and its stacked rows.
 * @param props - injected openers, the child-slot renderer, and locale.
 * @returns the chip and its menu.
 */
export function CapabilitiesMenu({ openData, renderSlot, t }: CapabilitiesMenuProps) {
  const [open, setOpen] = useState(false)
  const close = (): void => { setOpen(false) }
  return (
    <Menu
      open={open}
      onClose={close}
      align="start"
      portal
      items={[{ id: 'data', label: t('chip') }]}
      onSelect={(id) => {
        close()
        if (id === 'data') openData()
      }}
      anchor={(
        <button
          type="button"
          className={css.chip}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span>{t('capabilities.title')}</span>
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    >
      {renderSlot(CAPABILITIES_ITEM_SLOT, { close })}
    </Menu>
  )
}
