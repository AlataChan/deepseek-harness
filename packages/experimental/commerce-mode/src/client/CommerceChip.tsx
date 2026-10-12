/**
 * One hero chip whose menu opens the commerce gate or stages the
 * public-service preset. A fifth chip does not fit the hero row.
 */

import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CommerceKey } from './locales.ts'
import css from './CommerceChip.module.css'

/** Actions the chip needs from the conversation-scoped seat. */
export interface CommerceChipInjected {
  /** Stage the commerce preset without applying, then occupy the gate. */
  openGate: () => void
  /** Stage the public-service preset for the next session. */
  openNgo: () => void
}

/** Chip props: locale plus the two openers. */
export interface CommerceChipProps extends CommerceChipInjected {
  t: (key: CommerceKey) => string
}

/**
 * Render the specialist menu: 电商助手 and 公益项目助手.
 * @param props - locale and openers.
 * @returns the chip and its menu.
 */
export function CommerceChip({ openGate, openNgo, t }: CommerceChipProps) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      align="start"
      portal
      items={[
        { id: 'commerce', label: t('chip') },
        { id: 'ngo', label: t('chip.ngo') },
      ]}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'ngo') openNgo()
        else openGate()
      }}
      anchor={(
        <button
          type="button"
          className={css.chip}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span>{t('chip.menu')}</span>
          <IconChevronDownOutlineRegular className={css.chevron} />
        </button>
      )}
    />
  )
}
