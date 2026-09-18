/**
 * Shared workbench identity: letter avatar, name, optional document count, type badge.
 */

import { formatDocumentCount, libraryHueIndex, libraryInitial } from './library-initial.ts'
import css from './SourceIdentity.module.css'

/** Props for one data-source identity row. */
export interface SourceIdentityProps {
  readonly name: string
  readonly badge: string
  readonly documentCount?: number
  readonly countTemplate?: string
}

const HUE_CLASS = [css.hue0, css.hue1, css.hue2] as const

/**
 * Render avatar + name + optional count + type badge.
 * @param props - name, badge, optional count.
 * @returns the identity cluster.
 */
export function SourceIdentity({
  name, badge, documentCount, countTemplate,
}: SourceIdentityProps) {
  const hue = HUE_CLASS[libraryHueIndex(name)]
  const countText = documentCount === undefined || countTemplate === undefined
    ? undefined
    : formatDocumentCount(countTemplate, documentCount)
  return (
    <span className={css.identity}>
      <span className={`${css.avatar} ${hue}`} aria-hidden>
        {libraryInitial(name)}
      </span>
      <span className={css.name}>{name}</span>
      {countText === undefined ? null : <span className={css.count}>{countText}</span>}
      <span className={css.badge}>{badge}</span>
    </span>
  )
}
