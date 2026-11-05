/**
 * Locale lookup for desktop-operation status.
 * Ready has no extra sentence. The sentences are owned by src/copy.ts.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/client/status
 */

import { desktopOperationCopy } from '../copy.ts'

/** Status the Host can publish. */
export type DesktopOperationNotice = 'ready' | 'platform-unsupported' | 'permission-denied' | 'status-unavailable'

/**
 * Map a status to the locale sentence.
 * @param notice - ready, unsupported platform, or permission denial.
 * @param locale - `en` or `zh`.
 * @returns the sentence, or an empty string when the host is ready.
 */
export function desktopOperationStatusText(notice: DesktopOperationNotice, locale: 'en' | 'zh'): string {
  if (notice === 'ready') return ''
  const copy = desktopOperationCopy[locale]
  if (notice === 'platform-unsupported') return copy.platformUnsupported
  if (notice === 'permission-denied') return copy.permissionDenied
  return copy.statusUnavailable
}
