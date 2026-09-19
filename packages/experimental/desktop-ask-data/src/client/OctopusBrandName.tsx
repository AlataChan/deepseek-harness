/**
 * Sidebar wordmark for the desktop overlay.
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

/** Locale seat for the official sidebar brand-name hole. */
export type OctopusBrandNameProps = PropsLocale<'desktop-ask-data'>

/**
 * Render the overlay window brand.
 * @param props - locale seat injected by the slot registration.
 * @returns the wordmark span.
 */
export function OctopusBrandName({ t }: OctopusBrandNameProps) {
  return <span>{t('brandName')}</span>
}
