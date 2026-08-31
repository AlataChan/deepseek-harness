/**
 * Blank-session headline for the desktop overlay.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Host typography plus this overlay's locale seat. */
export type OctopusHeroHeadlineProps = {
  /** Host class preserving the official headline typography. */
  className?: string | undefined
} & PropsLocale<'desktop-ask-data'>

/**
 * Render the overlay headline.
 * @param props - host class and locale seat.
 * @returns the headline span.
 */
export function OctopusHeroHeadline({ className, t }: OctopusHeroHeadlineProps) {
  return <span className={className}>{t('heroHeadline')}</span>
}
