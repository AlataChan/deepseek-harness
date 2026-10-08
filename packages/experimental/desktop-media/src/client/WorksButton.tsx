/**
 * Sidebar footer Works trigger.
 */

import { useEffect, useRef, useState } from 'react'
import { IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import { setWorksOpen, subscribeWorks, worksOpen } from './works-state.ts'
import css from './WorksButton.module.css'

/** Full props of the sidebar Works button. */
export type WorksButtonProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>

/**
 * Render the Works footer action. Collapsed sidebars show only the icon.
 * @param props - column width and locale.
 * @returns the footer button.
 */
export function WorksButton({ wide, t }: WorksButtonProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [, setTick] = useState(0)
  useEffect(() => subscribeWorks(() => {
    setTick(n => n + 1)
    if (!worksOpen()) button.current?.focus()
  }), [])
  const label = t('works.button')
  return (
    <button
      ref={button}
      type="button"
      className={wide ? css.wide : css.rail}
      aria-label={label}
      aria-expanded={worksOpen()}
      onClick={() => { setWorksOpen(!worksOpen()) }}
    >
      <IconPlayOutlineRegular size={16} />
      {wide ? <span>{label}</span> : null}
    </button>
  )
}
