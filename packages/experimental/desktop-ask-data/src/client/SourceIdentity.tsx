/**
 * Shared workbench identity: letter avatar, name, type badge.
 */

import { sourceHueIndex, sourceInitial } from './source-initial.ts'
import css from './SourceIdentity.module.css'

/** Props for one data-source identity row. */
export interface SourceIdentityProps {
  readonly name: string
  readonly badge: string
}

const HUE_CLASS = [css.hue0, css.hue1, css.hue2] as const

/**
 * Render avatar + name + type badge.
 * @param props - name and badge.
 * @returns the identity cluster.
 */
export function SourceIdentity({ name, badge }: SourceIdentityProps) {
  const hue = HUE_CLASS[sourceHueIndex(name)]
  return (
    <span className={css.identity}>
      <span className={`${css.avatar} ${hue}`} aria-hidden>
        {sourceInitial(name)}
      </span>
      <span className={css.name}>{name}</span>
      <span className={css.badge}>{badge}</span>
    </span>
  )
}
